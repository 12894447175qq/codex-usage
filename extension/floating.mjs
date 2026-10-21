export const floatingURL = api => api.runtime.getURL('dashboard.html?window=1');
const ownContexts = api => api.runtime.getContexts({ documentUrls: [floatingURL(api)] });
const ownsWindow = (contexts, window) => window.type === 'popup' && contexts.some(context => context.windowId === window.id);
const dimension = (value, fallback, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

export async function openFloating(api) {
  // Own extension contexts identify the window without reading browser tab URLs.
  const [windows, contexts] = await Promise.all([api.windows.getAll(), ownContexts(api)]);
  const existing = windows.find(window => ownsWindow(contexts, window));
  if (existing) {
    await api.windows.update(existing.id, { focused: true });
    return { ok: true, windowId: existing.id };
  }
  const { floatingSize = {} } = await api.storage.local.get('floatingSize');
  const created = await api.windows.create({
    url: floatingURL(api), type: 'popup', focused: true,
    width: dimension(floatingSize.width, 780, 440, 1800),
    height: dimension(floatingSize.height, 760, 460, 1400),
  });
  return { ok: true, windowId: created.id };
}

export async function rememberFloatingSize(api, changed) {
  // Bounds events also cover unrelated browser windows; inspect only our page.
  if (changed.type !== 'popup' || changed.state !== 'normal') return;
  const contexts = await ownContexts(api);
  if (!contexts.some(context => context.windowId === changed.id)) return;
  const window = await api.windows.get(changed.id);
  if (!ownsWindow(contexts, window) || window.state !== 'normal') return;
  await api.storage.local.set({ floatingSize: { width: window.width, height: window.height } });
}
