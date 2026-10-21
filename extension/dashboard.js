import { selectDays, summarize, formatTokens, quotaTimeline } from './data.mjs';
import { createTokenScale } from './token-scale.mjs';
const $ = id => document.getElementById(id);
const windowMode = new URLSearchParams(location.search).get('window') === '1';
document.documentElement.classList.toggle('window-mode', windowMode);
$('window-help').hidden = !windowMode;
$('open-floating').hidden = windowMode;
const palette = ['#2463cf', '#19837b', '#8d5bb7', '#c17b1e', '#476c94', '#a95c69'];
const fmt = n => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let report, colors = new Map(), busy = false, activeMetric = 'totalTokens';
let expandedAxis = false;
let preferences = {}, rangeError = null;
let reportStatus = { text: '正在读取统计…', error: false };
function remember() {
  preferences = Object.fromEntries(['range', 'model', 'layout', 'quota-bucket'].map(id => [id, $(id).value]));
  preferences.metric = activeMetric;
  preferences.tokenChartVersion = 1;
  chrome.storage.local.set({ preferences }).catch(() => {});
}
const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
function paintStatus() {
  $('status').textContent = rangeError ?? reportStatus.text;
  $('status').classList.toggle('error', Boolean(rangeError) || reportStatus.error);
}
function status(text, error = false) { reportStatus = { text, error }; paintStatus(); }
async function request(type, force = false, payload = {}) {
  return chrome.runtime.sendMessage({ type, force, ...payload });
}
function selectRange(value) {
  $('range').value = value;
  expandedAxis = false;
  remember(); render();
}
function syncControls() {
  for (const button of document.querySelectorAll('[data-range]')) button.setAttribute('aria-pressed', String(button.dataset.range === $('range').value));
  const quota = activeMetric === 'quota';
  $('model').disabled = quota;
  $('model-label').textContent = quota ? '模型（额度按账户统计）' : '模型';
  $('model').title = quota ? '周额度不按模型筛选；用量汇总沿用原模型选择' : '筛选 Token 用量与明细';
  $('usage-caption').hidden = quota;
  $('token-tools').hidden = quota;
  $('legend').hidden = quota;
  $('model-details').hidden = quota;
}
function showEmpty(container, title, description) {
  const empty = node('div'); empty.className = 'empty';
  empty.append(node('strong', title), node('p', description));
  const button = node('button', $('range').value === '7' ? '刷新数据' : '查看最近 7 天');
  button.type = 'button';
  button.onclick = () => {
    if ($('range').value === '7') refresh(true);
    else { selectRange('7'); document.querySelector('[data-range="7"]').focus(); }
  };
  empty.append(button); container.append(empty);
}
function showTooltip(label, x, y) {
  const tip = $('tooltip'); tip.textContent = label; tip.hidden = false;
  tip.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8)) + 'px';
  tip.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - tip.offsetHeight - 8)) + 'px';
}
function useReport(value) {
  report = value;
  const selected = preferences.model ?? $('model').value;
  const names = [...new Set(report.days.flatMap(d => d.models.map(m => m.model)))].sort();
  colors = new Map(names.map((name, i) => [name, palette[i % palette.length]]));
  $('model').replaceChildren(new Option('全部模型', 'all'), ...names.map(n => new Option(n, n)));
  if (names.includes(selected)) $('model').value = selected;
  const selectedBucket = preferences['quota-bucket'] ?? $('quota-bucket').value;
  const buckets = new Map((report.quota?.weekly ?? []).map(snapshot => [`weekly:${snapshot.limitId ?? 'weekly'}`, snapshot.limitName ?? '每周额度']));
  if (!buckets.size) buckets.set('weekly:codex', '每周额度');
  $('quota-bucket').replaceChildren(...[...buckets].map(([id, name]) => new Option(name, id)));
  const bucket = selectedBucket === 'weekly:weekly' && buckets.has('weekly:codex') ? 'weekly:codex' : selectedBucket;
  if (buckets.has(bucket)) $('quota-bucket').value = bucket;
  $('quota-selector').hidden = buckets.size <= 1;
  render();
  const synced = new Date(report.syncedAt);
  $('meta').textContent = `北京时间 ${report.stale ? '缓存 · ' : ''}${synced.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  $('meta').title = `最后同步：${synced.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · capisoft ${report.version} · 本地保存 ${report.historyDays ?? report.days.length} 天`;
}
function dates() {
  const range = ['1', '7', '30'].includes($('range').value) ? Number($('range').value) : 1;
  const end = today();
  const start = new Date(`${end}T00:00:00Z`);
  // 预设范围包含北京时间今天。
  start.setUTCDate(start.getUTCDate() - (range - 1));
  return [start.toISOString().slice(0, 10), end];
}

const svgNode = (tag, attrs, text) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
};
function tokenChart(days, names) {
  const container = $('token-chart'); container.replaceChildren();
  $('tooltip').hidden = true;
  $('axis-toggle').hidden = $('axis-note').hidden = true;
  if (!days.length || !names.length) { showEmpty(container, '这段时间没有用量记录', '可切换日期，或刷新读取本机记录。'); return; }
  const grouped = $('layout').value === 'grouped';
  const width = Math.max(340, container.clientWidth, days.length * Math.max(24, grouped ? names.length * 9 + 10 : 24));
  const chartHeight = windowMode ? Math.max(200, Math.min(380, window.innerHeight - 340)) : 190;
  const svg = svgNode('svg', { width, height: chartHeight, viewBox: `0 0 ${width} ${chartHeight}`, role: 'img', 'aria-label': '每日模型 Token 柱状图，详细数据见下方表格' });
  const left = 62, top = 20, height = chartHeight - 48, right = width - 10, slot = (right - left) / days.length;
  const values = days.flatMap(day => {
    let cumulative = 0;
    return names.map(name => {
      const value = day.models.find(model => model.model === name)?.totalTokens ?? 0;
      cumulative += value;
      return grouped ? value : cumulative;
    });
  });
  const scale = createTokenScale(values, height, expandedAxis);
  const yAt = value => top + height - scale.map(value);
  const broken = scale.breaks.length > 0;
  $('axis-toggle').hidden = !scale.availableBreaks.length;
  $('axis-toggle').textContent = expandedAxis ? '恢复断轴' : '展开刻度';
  $('axis-toggle').setAttribute('aria-expanded', String(expandedAxis));
  $('axis-note').hidden = !broken;
  svg.setAttribute('aria-label', `每日模型 Token ${grouped ? '分组' : '堆叠'}柱状图${broken ? '，采用断轴分段刻度' : ''}，详细数据见下方表格`);
  for (const value of scale.ticks) {
    const y = yAt(value);
    svg.append(svgNode('line', { x1: left, x2: right, y1: y, y2: y, stroke: '#e8edf4', 'stroke-dasharray': value === 0 ? '0' : '3 3' }));
    const lowerEdge = scale.breaks.some(item => item.start === value);
    const upperEdge = scale.breaks.some(item => item.end === value);
    const labelY = y + (lowerEdge ? 12 : upperEdge ? -6 : 4);
    const label = value < 1e4 ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : formatTokens(value);
    svg.append(svgNode('text', { x: left - 9, y: labelY, 'text-anchor': 'end', class: 'token-tick' }, label));
  }
  days.forEach((d, i) => {
    let offset = 0;
    names.forEach((name, j) => {
      const m = d.models.find(m => m.model === name); if (!m) return;
      const value = m.totalTokens;
      if (!(value > 0)) return;
      const start = grouped ? 0 : offset, end = start + value;
      const h = scale.map(end) - scale.map(start);
      const groupWidth = Math.min(slot * .72, grouped ? names.length * 28 : 48);
      const barWidth = grouped ? groupWidth / names.length : groupWidth;
      const x = left + slot * i + (slot - groupWidth) / 2 + (grouped ? j * barWidth : 0);
      const bar = svgNode('g', { class: 'token-bar', tabindex: 0, role: 'img', 'data-model': name, 'data-date': d.date, 'data-value': value });
      const rect = svgNode('rect', { x, y: yAt(end), width: Math.max(1, barWidth - 2), height: h, fill: colors.get(name), rx: 2 });
      const label = `${d.date} · ${name}\n输入 ${fmt(m.inputTokens)} · 缓存读取 ${fmt(m.cacheReadTokens)} · 缓存写入 ${fmt(m.cacheCreationTokens)} · 输出 ${fmt(m.outputTokens)}\nToken ${fmt(m.totalTokens)}`;
      bar.append(svgNode('title', {}, label), rect); bar.setAttribute('aria-label', label);
      bar.addEventListener('mousemove', e => showTooltip(label, e.clientX, e.clientY));
      bar.addEventListener('focus', () => { const box = rect.getBoundingClientRect(); showTooltip(label, box.right, box.top); });
      for (const event of ['mouseleave', 'blur']) bar.addEventListener(event, () => { $('tooltip').hidden = true; });
      svg.append(bar); if (!grouped) offset += value;
    });
    if (i % Math.max(1, Math.ceil(days.length / (width / 55))) === 0) svg.append(svgNode('text', { x: left + slot * (i + .5), y: chartHeight - 9, 'text-anchor': 'middle' }, d.date.slice(5)));
  });
  for (const item of scale.breaks) {
    const y = (yAt(item.start) + yAt(item.end)) / 2;
    const label = `展开 ${formatTokens(item.start)} 至 ${formatTokens(item.end)} Token 的断轴`;
    const button = svgNode('g', { class: 'axis-break', role: 'button', tabindex: 0, 'aria-label': label });
    const points = Array.from({ length: Math.ceil((right - left) / 7) + 1 }, (_, i) => `${i ? 'L' : 'M'} ${Math.min(right, left + i * 7)} ${y + (i % 2 ? 2 : -2)}`).join(' ');
    button.append(svgNode('title', {}, label), svgNode('rect', { x: left - 4, y: y - 9, width: right - left + 8, height: 18, fill: 'transparent' }), svgNode('path', { d: points, class: 'break-mask' }), svgNode('path', { d: points, class: 'break-line' }));
    const expand = () => { expandedAxis = true; render(); $('axis-toggle').focus({ preventScroll: true }); };
    button.addEventListener('click', expand);
    button.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); expand(); } });
    svg.append(button);
  }
  container.append(svg);
}
function quotaChart(id, snapshots, from, to, windowName) {
  const container = $(id); container.replaceChildren();
  $('tooltip').hidden = true;
  const { points: observations, startTime, endTime } = quotaTimeline(snapshots, from, to);
  snapshots = observations;
  $('quota-period').textContent = `${from === to ? from : `${from.slice(5)} — ${to.slice(5)}`} · ${snapshots.length} 条观测`;
  if (report.quota?.error) $('quota-observation').open = true;
  $('quota-state').textContent = report.quota?.error ? `读取失败：${report.quota.error}；保留此前快照` : '按实际采集时间显示全部观测；重置或缺失日期处断线，不补造未采集的数值。';
  if (!snapshots.length) { showEmpty(container, '这段时间没有周额度记录', '额度在打开或刷新时采集，未采集时段没有记录。'); $('quota-latest').textContent = '—'; return; }
  const latest = snapshots.at(-1);
  const stamp = new Date(latest.capturedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const resetAt = latest.resetsAt ? new Date(typeof latest.resetsAt === 'number' ? latest.resetsAt * 1000 : latest.resetsAt) : null;
  $('quota-state').textContent += ` 最后采集 ${stamp}${latest.source === 'manual' ? '（手工）' : ''}${resetAt && Number.isFinite(resetAt.getTime()) ? ' · 重置 ' + resetAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}`;
  const width = Math.max(340, container.clientWidth);
  const chartHeight = windowMode ? Math.max(180, Math.min(340, window.innerHeight - 410)) : 155;
  const height = chartHeight - 50, left = 42, right = 12, top = 18, graphWidth = width - left - right;
  const svg = svgNode('svg', { width, height: chartHeight, viewBox: `0 0 ${width} ${chartHeight}`, role: 'img', 'aria-label': `${windowName}剩余百分比折线图`, class: snapshots.length > 60 ? 'quota-dense' : '' });
  for (let i = 0; i <= 4; i++) {
    const value = 100 - i * 25;
    const y = top + height * i / 4;
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y, y2: y, 'stroke-dasharray': i === 4 ? '0' : '3 3' }));
    svg.append(svgNode('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, `${value}%`));
  }
  const point = snapshot => ({
    x: endTime === startTime ? left + graphWidth / 2 : left + graphWidth * (snapshot.time - startTime) / (endTime - startTime),
    y: top + height * (1 - Math.max(0, Math.min(100, snapshot.remainingPercent)) / 100),
  });
  const points = snapshots.map(point);
  const path = points.map((p, i) => `${snapshots[i].breakBefore ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  svg.append(svgNode('path', { d: path }));
  const labelOf = snapshot => `${snapshot.startsNewCycle ? '重置后首次观测 · ' : ''}${snapshot.date} · ${windowName}剩余 ${snapshot.remainingPercent}%\n记录于 ${new Date(snapshot.capturedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
  snapshots.forEach((snapshot, i) => {
    const p = points[i], label = labelOf(snapshot);
    if (snapshot.startsNewCycle) {
      svg.append(svgNode('line', { x1: p.x, x2: p.x, y1: top, y2: top + height, class: 'quota-reset-line' }));
      svg.append(svgNode('text', { x: Math.max(left + 2, Math.min(width - right - 36, p.x + 4)), y: top - 6, class: 'quota-reset-label' }, '重置后'));
    }
    const circle = svgNode('circle', { cx: p.x, cy: p.y, r: snapshot.startsNewCycle ? 4 : snapshots.length > 60 ? 1.8 : 3.5, tabindex: 0, 'aria-label': label, 'data-captured-at': snapshot.capturedAt, 'data-remaining': snapshot.remainingPercent, class: snapshot.startsNewCycle ? 'quota-cycle-start' : 'quota-point' });
    circle.append(svgNode('title', {}, label));
    circle.addEventListener('focus', () => { const box = circle.getBoundingClientRect(); showTooltip(label, box.right, box.top); });
    circle.addEventListener('blur', () => { $('tooltip').hidden = true; });
    svg.append(circle);
  });
  // Evenly spaced axis labels remain legible when observations cluster near now.
  const tickCount = from === to && endTime === startTime ? 0 : Math.max(2, Math.min(4, Math.floor(graphWidth / 100)));
  for (let i = 0; i <= tickCount; i++) {
    const fraction = tickCount ? i / tickCount : .5;
    const label = from === to
      ? new Date(startTime + (endTime - startTime) * fraction).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(startTime + (endTime - startTime) * fraction)).slice(5);
    svg.append(svgNode('text', { x: left + graphWidth * fraction, y: chartHeight - 9, 'text-anchor': !tickCount ? 'middle' : i === 0 ? 'start' : i === tickCount ? 'end' : 'middle', class: 'axis-time' }, label));
  }
  svg.addEventListener('mousemove', event => {
    const bounds = svg.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    if (x < left || x > width - right || y < top || y > top + height) { $('tooltip').hidden = true; return; }
    let nearest = 0;
    points.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(points[nearest].x - x)) nearest = i; });
    showTooltip(labelOf(snapshots[nearest]), event.clientX, event.clientY);
  });
  svg.addEventListener('mouseleave', () => { $('tooltip').hidden = true; });
  $('quota-latest').textContent = `${latest.remainingPercent}%`;
  container.append(svg);
}


function render() {
  syncControls();
  if (!report) return;
  const [from, to] = dates();
  let days;
  try { days = selectDays(report, from, to, $('model').value); }
  catch (error) {
    rangeError = error.message;
    for (const id of ['tokens', 'models', 'quota-latest']) $(id).textContent = '—';
    $('quota-state').textContent = rangeError;
    $('axis-toggle').hidden = $('axis-note').hidden = true;
    $('legend').replaceChildren(); $('details').replaceChildren();
    for (const id of ['token-chart', 'quota-chart']) {
      const empty = node('div', rangeError); empty.className = 'empty'; $(id).replaceChildren(empty);
    }
    paintStatus(); return;
  }
  rangeError = null; paintStatus();
  const rows = days.flatMap(d => d.models.map(m => ({ date: d.date, ...m })));
  const names = [...new Set(rows.map(m => m.model))].sort();
  const summary = summarize(rows);
  $('tokens').textContent = formatTokens(summary.tokens);
  $('tokens').title = `${fmt(summary.tokens)} Token`;
  $('models').textContent = names.length;
  $('chart-period').textContent = from === to ? `${from} · 按模型` : `${from.slice(5)} — ${to.slice(5)} · 按天`;
  $('legend').replaceChildren(...names.map(name => {
    const item = node('button'); item.type = 'button'; item.dataset.model = name;
    const dot = node('i'); dot.className = 'dot'; dot.style.background = colors.get(name);
    item.title = $('model').value === name ? '点击恢复全部模型' : `仅看 ${name}`;
    item.setAttribute('aria-pressed', String($('model').value === name));
    item.append(dot, document.createTextNode(name));
    item.onclick = () => {
      $('model').value = $('model').value === name ? 'all' : name; expandedAxis = false; remember(); render();
      [...$('legend').children].find(button => button.dataset.model === name)?.focus({ preventScroll: true });
    };
    return item;
  }));
  const quota = activeMetric === 'quota';
  if (quota) {
    const separator = $('quota-bucket').value.indexOf(':');
    const limitId = $('quota-bucket').value.slice(separator + 1);
    const snapshots = (report.quota?.weekly ?? []).filter(snapshot => (snapshot.limitId ?? 'weekly') === limitId);
    quotaChart('quota-chart', snapshots, from, to, '每周额度');
  } else {
    tokenChart(days, names);
  }
  $('details').replaceChildren(...[...rows].reverse().map(m => { const tr = node('tr'); tr.append(...[m.date, m.model, fmt(m.inputTokens), fmt(m.cacheReadTokens), fmt(m.cacheCreationTokens), fmt(m.outputTokens), fmt(m.totalTokens)].map(v => node('td', v))); return tr; }));
}
async function refresh(force = false) {
  if (busy) return; busy = true; $('refresh').disabled = $('open-dashboard').disabled = true;
  document.querySelector('main').setAttribute('aria-busy', 'true'); $('refresh-label').textContent = '同步中';
  status(force ? '正在强制扫描 Codex 日志…' : activeMetric === 'quota' ? '正在更新周额度…' : '正在读取本机 Codex 日志…');
  try {
    const result = await request('sync', force);
    if (result.report) useReport(result.report);
    if (!result.ok) status(`同步失败，${report ? '正在显示上次成功结果' : '尚无可用数据'}：${result.error}`, true);
    else status(['已同步', ...(result.report.warnings ?? [])].join('\n'), result.report.warnings?.length > 0);
  } catch (e) { status(`无法连接本地采集程序。请按 README 安装后重试。${report ? ' 当前保留上次成功结果。' : ''}\n${e.message}`, true); }
  finally { busy = false; $('refresh').disabled = $('open-dashboard').disabled = false; document.querySelector('main').setAttribute('aria-busy', 'false'); $('refresh-label').textContent = '刷新'; }
}
$('refresh').onclick = () => refresh(true);
$('open-floating').onclick = async () => {
  $('open-floating').disabled = true;
  try {
    const result = await request('floating');
    status(result?.ok ? '独立浮窗已打开，可拖动标题栏和窗口边缘' : `无法打开独立浮窗：${result?.error || '未知错误'}`, !result?.ok);
  } catch (error) { status(`无法打开独立浮窗：${error.message}`, true); }
  finally { $('open-floating').disabled = false; }
};
$('open-dashboard').onclick = async () => {
  $('open-dashboard').disabled = true;
  status('正在打开完整分析面板…');
  try {
    const result = await request('dashboard');
    status(result?.ok ? '完整分析面板已在新标签页打开' : `无法打开完整分析面板：${result?.error || '未知错误'}`, !result?.ok);
  } catch (error) { status(`无法打开完整分析面板：${error.message}`, true); }
  finally { $('open-dashboard').disabled = false; }
};
for (const button of document.querySelectorAll('[data-range]')) button.onclick = () => selectRange(button.dataset.range);
$('quota-bucket').onchange = () => { remember(); render(); };
function selectMetric(metric) {
  activeMetric = metric;
  const panels = { totalTokens: 'token-panel', quota: 'quota-panel' };
  for (const [value, panel] of Object.entries(panels)) {
    const selected = value === metric;
    $(panel).hidden = !selected;
    const tab = value === 'totalTokens' ? 'tab-tokens' : 'tab-quota';
    $(tab).setAttribute('aria-selected', String(selected)); $(tab).tabIndex = selected ? 0 : -1;
  }
  remember();
  render();
  if (metric === 'quota') refresh();
}
$('tab-tokens').onclick = () => selectMetric('totalTokens');
$('tab-quota').onclick = () => selectMetric('quota');
for (const id of ['tab-tokens', 'tab-quota']) $(id).onkeydown = e => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const metrics = ['totalTokens', 'quota'];
    const index = metrics.indexOf(activeMetric);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? metrics.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + metrics.length) % metrics.length;
    const metric = metrics[next];
    selectMetric(metric); $(metric === 'totalTokens' ? 'tab-tokens' : 'tab-quota').focus();
  }
};
document.addEventListener('scroll', () => { $('tooltip').hidden = true; }, true);
for (const id of ['range', 'model', 'layout']) $(id).onchange = () => { expandedAxis = false; remember(); render(); };
window.addEventListener('resize', render);
$('axis-toggle').onclick = () => { expandedAxis = !expandedAxis; render(); };
try {
  preferences = (await chrome.storage.local.get('preferences')).preferences ?? {};
  const migratePreferences = preferences.range === 'custom' || preferences.metric === 'costUSD' || preferences.tokenChartVersion !== 1;
  if (preferences.tokenChartVersion !== 1) { preferences.layout = 'grouped'; preferences.tokenChartVersion = 1; }
  if (preferences.range === 'custom') {
    preferences.range = '1';
    delete preferences.from; delete preferences.to;
  }
  if (preferences.metric === 'costUSD') preferences.metric = 'totalTokens';
  for (const id of ['range', 'layout']) if ([...$(id).options].some(option => option.value === preferences[id])) $(id).value = preferences[id];
  if (migratePreferences) chrome.storage.local.set({ preferences }).catch(() => {});
  if (['totalTokens', 'quota'].includes(preferences.metric)) {
    activeMetric = preferences.metric;
    // 数据加载后统一渲染；此处只恢复标签面板，保留模型和额度偏好。
    const panels = { totalTokens: ['token-panel', 'tab-tokens'], quota: ['quota-panel', 'tab-quota'] };
    for (const [metric, [panel, tab]] of Object.entries(panels)) {
      $(panel).hidden = metric !== activeMetric;
      $(tab).setAttribute('aria-selected', String(metric === activeMetric));
      $(tab).tabIndex = metric === activeMetric ? 0 : -1;
    }
  }
} catch { /* 偏好读取失败不影响统计。 */ }
syncControls();
try { const cached = await request('cache'); if (cached.report) useReport(cached.report); } catch { /* 安装提示统一由刷新显示。 */ }
await refresh();
