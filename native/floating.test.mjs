import test from 'node:test';
import assert from 'node:assert/strict';
import { openFloating, rememberFloatingSize } from '../extension/floating.mjs';

const page = 'chrome-extension://fixture/dashboard.html?window=1';
function fixture(windows = [], ownWindowIds = []) {
  const calls = [];
  const api = {
    runtime: { getURL: () => page, getContexts: async filter => {
      assert.deepEqual(filter, { documentUrls: [page] });
      return ownWindowIds.map(windowId => ({ windowId }));
    } },
    windows: {
      getAll: async () => windows,
      update: async (...args) => calls.push(['update', ...args]),
      create: async value => { calls.push(['create', value]); return { id: 7 }; },
      get: async id => windows.find(window => window.id === id),
    },
    storage: { local: {
      get: async () => ({ floatingSize: { width: 920, height: 800 } }),
      set: async value => calls.push(['save', value]),
    } },
  };
  return { api, calls };
}

test('独立浮窗使用已保存大小创建，已打开时只聚焦原窗口', async () => {
  const { api, calls } = fixture();
  assert.equal((await openFloating(api)).windowId, 7);
  assert.deepEqual(calls[0], ['create', { url: page, type: 'popup', focused: true, width: 920, height: 800 }]);
  // Tab URL fields are absent: no tabs permission is needed for reuse.
  const existing = fixture([{ id: 10, type: 'normal' }, { id: 9, type: 'popup' }], [10, 9]);
  await openFloating(existing.api);
  assert.deepEqual(existing.calls, [['update', 9, { focused: true }]]);
});

test('只保存自身普通浮窗大小，不把其他页面或最大化窗口当成偏好', async () => {
  const { api, calls } = fixture([{ id: 9, type: 'popup', state: 'normal', width: 900, height: 700 }, { id: 10, type: 'popup' }], [9]);
  await rememberFloatingSize(api, { id: 10, type: 'popup', state: 'normal' });
  await rememberFloatingSize(api, { id: 9, type: 'popup', state: 'maximized' });
  assert.deepEqual(calls, []);
  await rememberFloatingSize(api, { id: 9, type: 'popup', state: 'normal' });
  assert.deepEqual(calls, [['save', { floatingSize: { width: 900, height: 700 } }]]);
});
