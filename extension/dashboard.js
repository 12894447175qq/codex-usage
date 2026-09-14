const $ = id => document.getElementById(id);
const palette = ['#1976d2', '#66b5ed', '#42a5b7', '#ab87dc', '#536dce', '#edb45e'];
const fmt = n => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n);
const usd = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let report, colors = new Map(), busy = false, activeMetric = 'totalTokens';
const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function request(type, force = false, payload = {}) {
  return chrome.runtime.sendMessage({ type, force, ...payload });
}
function useReport(value) {
  report = value;
  const selected = $('model').value;
  const names = [...new Set(report.days.flatMap(d => d.models.map(m => m.model)))].sort();
  colors = new Map(names.map((name, i) => [name, palette[i % palette.length]]));
  $('model').replaceChildren(new Option('全部模型', 'all'), ...names.map(n => new Option(n, n)));
  if (names.includes(selected)) $('model').value = selected;
  const bucket = $('quota-bucket').value;
  const buckets = new Map([
    ...(report.quota?.weekly ?? []).map(s => [`weekly:${s.limitId ?? 'weekly'}`, s.limitName ?? '每周额度']),
    ...(report.quota?.fiveHour ?? []).map(s => [`five-hour:${s.limitId ?? 'five-hour'}`, s.limitName ?? '5 小时额度']),
  ]);
  if (!buckets.size) buckets.set('weekly:weekly', '每周额度');
  $('quota-bucket').replaceChildren(...[...buckets].map(([id, name]) => new Option(name, id)));
  if (buckets.has(bucket)) $('quota-bucket').value = bucket;
  render();
  const synced = new Date(report.syncedAt);
  $('meta').textContent = synced.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  $('meta').title = `最后同步：${synced.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · capisoft ${report.version} · 本地保存 ${report.historyDays ?? report.days.length} 天 · ${report.pricingSource}`;
}
function dates() {
  const range = $('range').value;
  if (range !== 'custom') {
    const end = today();
    const start = new Date(`${end}T00:00:00Z`);
    // 预设范围包含北京时间今天。
    start.setUTCDate(start.getUTCDate() - (Number(range) - 1));
    $('from').value = start.toISOString().slice(0, 10);
    $('to').value = end;
  }
  return [$('from').value, $('to').value];
}
const svgNode = (tag, attrs, text) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
};
function chart(id, days, names, metric) {
  const container = $(id); container.replaceChildren();
  $('tooltip').hidden = true;
  if (!days.length || !names.length) { const empty = node('div', '所选范围暂无本地记录'); empty.className = 'empty'; container.append(empty); return; }
  const grouped = $('layout').value === 'grouped';
  const width = Math.max(340, container.clientWidth, days.length * Math.max(12, grouped ? names.length * 9 + 8 : 12));
  const svg = svgNode('svg', { width, height: 155, viewBox: `0 0 ${width} 155`, role: 'img', 'aria-label': metric === 'totalTokens' ? '每日模型 Token 柱状图，详细数据见下方表格' : '每日模型估算费用柱状图，详细数据见下方表格' });
  const values = days.map(d => d.models.map(m => m[metric] ?? 0));
  const peak = Math.max(0, ...values.map(v => grouped ? Math.max(0, ...v) : v.reduce((a, b) => a + b, 0)));
  // 按实际数据选取整洁的刻度，小额费用也保留可见高度。
  const step = peak ? 10 ** Math.floor(Math.log10(peak)) / 2 : 1;
  const max = peak ? Math.ceil(peak / step) * step : 1;
  const left = 52, height = 105, slot = (width - left - 12) / days.length;
  for (let i = 0; i <= 4; i++) {
    const y = 18 + height * i / 4;
    svg.append(svgNode('line', { x1: left, x2: width - 10, y1: y, y2: y, stroke: '#e8edf4', 'stroke-dasharray': i === 4 ? '0' : '3 3' }));
    const val = max * (1 - i / 4);
    const label = metric === 'costUSD' ? `$${val.toFixed(max < .01 ? 4 : 2)}` : val === 0 ? '0' : `${(val / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: val < 1e6 ? 4 : 2 })}亿`;
    svg.append(svgNode('text', { x: left - 10, y: y + 4, 'text-anchor': 'end' }, label));
  }
  days.forEach((d, i) => {
    let offset = 0;
    names.forEach((name, j) => {
      const m = d.models.find(m => m.model === name); if (!m) return;
      const value = m[metric];
      if (value === null) {
        svg.append(svgNode('text', { x: left + slot * (i + .5), y: 136, 'text-anchor': 'middle' }, '?'));
        return;
      }
      const h = value / max * height;
      const groupWidth = Math.min(slot * .68, grouped ? names.length * 26 : 48);
      const barWidth = grouped ? groupWidth / names.length : groupWidth;
      const x = left + slot * i + (slot - groupWidth) / 2 + (grouped ? j * barWidth : 0);
      const rect = svgNode('rect', { x, y: 18 + height - h - (grouped ? 0 : offset), width: Math.max(1, barWidth - 1), height: h, fill: colors.get(name), rx: 2, tabindex: 0 });
      const label = `${d.date} · ${name}\n输入 ${fmt(m.inputTokens)} · 缓存读取 ${fmt(m.cacheReadTokens)} · 缓存写入 ${fmt(m.cacheCreationTokens)} · 输出 ${fmt(m.outputTokens)}\nToken ${fmt(m.totalTokens)} · 估算费用 ${m.costUSD === null ? '未知' : '$' + usd(m.costUSD)}`;
      rect.append(svgNode('title', {}, label)); rect.setAttribute('aria-label', label);
      const showTip = (x, y) => {
        const tip = $('tooltip'); tip.textContent = label; tip.hidden = false;
        tip.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8)) + 'px';
        tip.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - tip.offsetHeight - 8)) + 'px';
      };
      rect.addEventListener('mousemove', e => showTip(e.clientX, e.clientY));
      rect.addEventListener('focus', () => { const box = rect.getBoundingClientRect(); showTip(box.right, box.top); });
      for (const event of ['mouseleave', 'blur']) rect.addEventListener(event, () => { $('tooltip').hidden = true; });
      svg.append(rect); if (!grouped) offset += h;
    });
    if (i % Math.max(1, Math.ceil(days.length / (width / 55))) === 0) svg.append(svgNode('text', { x: left + slot * (i + .5), y: 146, 'text-anchor': 'middle' }, d.date.slice(5)));
  });
  container.append(svg);
}
function quotaChart(id, snapshots, from, to, windowName) {
  const container = $(id); container.replaceChildren();
  $('tooltip').hidden = true;
  $('quota-period').textContent = from === to ? `${from} · 按分钟采集` : `${from.slice(5)} — ${to.slice(5)} · 每日最后一次`;
  $('quota-state').textContent = report.quota?.error ? `读取失败：${report.quota.error}；保留此前快照` : '打开或刷新时自动采集；未采集时段没有记录。';
  if (!snapshots.length) { const empty = node('div', '所选范围暂无额度快照，点击刷新获取当前额度'); empty.className = 'empty'; container.append(empty); $('quota-latest').textContent = '—'; return; }
  const latest = snapshots.at(-1);
  const stamp = new Date(latest.capturedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const resetAt = latest.resetsAt ? new Date(typeof latest.resetsAt === 'number' ? latest.resetsAt * 1000 : latest.resetsAt) : null;
  $('quota-state').textContent += ` 最后采集 ${stamp}${latest.source === 'manual' ? '（手工）' : ''}${resetAt && Number.isFinite(resetAt.getTime()) ? ' · 重置 ' + resetAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}`;
  if (from !== to) snapshots = [...new Map(snapshots.map(s => [s.date, s])).values()];
  const width = Math.max(340, container.clientWidth);
  const height = 105, left = 42, right = 12, top = 18, graphWidth = width - left - right;
  const span = Math.max(1, (Date.parse(to) - Date.parse(from)) / 86400000);
  const svg = svgNode('svg', { width, height: 155, viewBox: `0 0 ${width} 155`, role: 'img', 'aria-label': `${windowName}剩余百分比折线图` });
  for (let i = 0; i <= 4; i++) {
    const value = 100 - i * 25;
    const y = top + height * i / 4;
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y, y2: y, 'stroke-dasharray': i === 4 ? '0' : '3 3' }));
    svg.append(svgNode('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, `${value}%`));
  }
  const startTime = Date.parse(snapshots[0].capturedAt), endTime = Date.parse(snapshots.at(-1).capturedAt);
  const point = snapshot => ({
    x: from === to ? (endTime === startTime ? left + graphWidth / 2 : left + graphWidth * (Date.parse(snapshot.capturedAt) - startTime) / (endTime - startTime)) : left + graphWidth * (Date.parse(snapshot.date) - Date.parse(from)) / 86400000 / span,
    y: top + height * (1 - Math.max(0, Math.min(100, snapshot.remainingPercent)) / 100),
  });
  const points = snapshots.map(point);
  const path = points.map((p, i) => {
    const contiguous = i > 0 && snapshots[i].resetsAt === snapshots[i - 1].resetsAt && (from === to || (Date.parse(snapshots[i].date) - Date.parse(snapshots[i - 1].date)) / 86400000 === 1);
    return `${contiguous ? 'L' : 'M'} ${p.x} ${p.y}`;
  }).join(' ');
  svg.append(svgNode('path', { d: path }));
  snapshots.forEach((snapshot, i) => {
    const p = points[i];
    const label = `${snapshot.date} · ${windowName}剩余 ${snapshot.remainingPercent}%\n记录于 ${new Date(snapshot.capturedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    const circle = svgNode('circle', { cx: p.x, cy: p.y, r: 4, tabindex: 0, 'aria-label': label });
    circle.append(svgNode('title', {}, label));
    const showTip = (x, y) => {
      const tip = $('tooltip'); tip.textContent = label; tip.hidden = false;
      tip.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - tip.offsetHeight - 8)) + 'px';
    };
    circle.addEventListener('mousemove', event => showTip(event.clientX, event.clientY));
    circle.addEventListener('focus', () => { const box = circle.getBoundingClientRect(); showTip(box.right, box.top); });
    for (const event of ['mouseleave', 'blur']) circle.addEventListener(event, () => { $('tooltip').hidden = true; });
    svg.append(circle);
    if (i % Math.max(1, Math.ceil(snapshots.length / (width / 70))) === 0) svg.append(svgNode('text', { x: p.x, y: 146, 'text-anchor': 'middle' }, from === to ? new Date(snapshot.capturedAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }) : snapshot.date.slice(5)));
  });
  $('quota-latest').textContent = `${latest.remainingPercent}%`;
  container.append(svg);
}

function heatmapChart(from, to, days) {
  const container = $('heatmap-chart');
  container.replaceChildren();
  $('tooltip').hidden = true;
  const selectedModel = $('model').value;
  const hourly = from === to && report.heatmap?.date === from;
  const values = hourly
    ? (report.heatmap.hours ?? []).map(bucket => {
      const models = (bucket.models ?? []).filter(model => selectedModel === 'all' || model.model === selectedModel);
      return { label: `${String(bucket.hour).padStart(2, '0')}:00`, totalTokens: models.reduce((sum, model) => sum + model.totalTokens, 0), calls: models.reduce((sum, model) => sum + model.calls, 0) };
    })
    : days.map(day => ({ label: day.date, totalTokens: day.models.reduce((sum, model) => sum + model.totalTokens, 0), calls: day.models.reduce((sum, model) => sum + (model.calls ?? 0), 0) }));
  const peak = Math.max(0, ...values.map(value => value.totalTokens));
  const grid = node('div');
  grid.className = 'heatmap-grid';
  const columns = hourly ? 12 : values.length <= 7 ? Math.max(1, values.length) : values.length <= 31 ? 10 : Math.min(26, Math.ceil(values.length / 4));
  grid.style.setProperty('--heat-columns', columns);
  for (const value of values) {
    const cell = node('button');
    const level = value.totalTokens === 0 || peak === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil(value.totalTokens / peak * 4)));
    const label = `${value.label}\nToken ${fmt(value.totalTokens)} · ${value.calls} 次模型调用`;
    cell.type = 'button';
    cell.className = 'heatmap-cell';
    cell.dataset.level = level;
    cell.setAttribute('aria-label', label);
    cell.title = label;
    const showTip = event => {
      const tip = $('tooltip'); tip.textContent = label; tip.hidden = false;
      const box = event?.currentTarget?.getBoundingClientRect() ?? cell.getBoundingClientRect();
      const x = event?.clientX || box.right, y = event?.clientY || box.top;
      tip.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = Math.max(8, Math.min(y + 12, window.innerHeight - tip.offsetHeight - 8)) + 'px';
    };
    cell.addEventListener('mousemove', showTip);
    cell.addEventListener('focus', showTip);
    for (const event of ['mouseleave', 'blur']) cell.addEventListener(event, () => { $('tooltip').hidden = true; });
    grid.append(cell);
  }
  const legend = node('div');
  legend.className = 'heatmap-legend';
  legend.append(node('span', '少'));
  for (let level = 0; level <= 4; level++) { const swatch = node('i'); swatch.dataset.level = level; legend.append(swatch); }
  legend.append(node('span', '多'));
  const caption = node('div', hourly ? `${from} · 每小时 Token 活跃度` : `${from.slice(5)} — ${to.slice(5)} · 每日 Token 活跃度`);
  caption.className = 'heatmap-note';
  container.append(grid, legend, caption);
}
function render() {
  $('custom-dates').hidden = $('range').value !== 'custom';
  if (!report) return;
  const [from, to] = dates();
  if (!from || !to || from > to) return status('请选择有效的起止日期', true);
  const selected = new Map(report.days.filter(d => d.date >= from && d.date <= to).map(d => [d.date, d]));
  const days = [];
  // 缺少记录的日期保留空位，避免不连续日期被画成连续的每天。
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (count > 3660) return status('单次图表请选择不超过十年的范围', true);
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10);
    days.push({ date, models: (selected.get(date)?.models ?? []).filter(m => $('model').value === 'all' || m.model === $('model').value) });
  }
  const rows = days.flatMap(d => d.models.map(m => ({ date: d.date, ...m })));
  const names = [...new Set(rows.map(m => m.model))].sort();
  const totalTokens = rows.reduce((s, m) => s + m.totalTokens, 0);
  // 汇总卡片以亿 Token 展示，悬停保留精确计数。
  $('tokens').textContent = (totalTokens / 100_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 亿';
  $('tokens').title = `${fmt(totalTokens)} Token`;
  const totalCost = rows.reduce((s, m) => s + (m.costUSD ?? 0), 0);
  const unknownCost = rows.some(m => m.costUSD === null) ? ' + 未知' : '';
  $('cost').textContent = '$' + totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + unknownCost;
  $('cost').title = '$' + usd(totalCost) + unknownCost;
  $('models').textContent = names.length;
  $('chart-period').textContent = from === to ? `${from} · 按模型` : `${from.slice(5)} — ${to.slice(5)} · 按天`;
  $('legend').replaceChildren(...names.map(name => { const item = node('span'); const dot = node('i'); dot.className = 'dot'; dot.style.background = colors.get(name); item.append(dot, document.createTextNode(name)); return item; }));
  const quota = activeMetric === 'quota';
  const heatmap = activeMetric === 'heatmap';
  $('usage-caption').hidden = quota || heatmap;
  $('layout').parentElement.hidden = quota || heatmap;
  $('legend').hidden = quota || heatmap;
  $('model-details').hidden = quota || heatmap;
  if (quota) {
    const [window, limitId] = $('quota-bucket').value.split(':');
    const source = window === 'five-hour' ? report.quota?.fiveHour : report.quota?.weekly;
    const snapshots = (source ?? []).filter(snapshot => (snapshot.limitId ?? window) === limitId && snapshot.date >= from && snapshot.date <= to).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    quotaChart('quota-chart', snapshots, from, to, window === 'five-hour' ? '5 小时额度' : '每周额度');
  } else if (heatmap) {
    heatmapChart(from, to, days);
  } else {
    chart(activeMetric === 'totalTokens' ? 'token-chart' : 'cost-chart', days, names, activeMetric);
  }
  $('details').replaceChildren(...rows.reverse().map(m => { const tr = node('tr'); tr.append(...[m.date, m.model, fmt(m.inputTokens), fmt(m.cacheReadTokens), fmt(m.cacheCreationTokens), fmt(m.outputTokens), fmt(m.totalTokens), m.costUSD === null ? '未知' : usd(m.costUSD)].map(v => node('td', v))); return tr; }));
}
async function refresh(force = false) {
  if (busy) return; busy = true; $('refresh').disabled = $('open-dashboard').disabled = true;
  status(force ? '正在强制扫描 Codex 日志…' : '正在读取本机 Codex 日志…');
  try {
    const result = await request('sync', force);
    if (result.report) useReport(result.report);
    if (!result.ok) status(`同步失败，${report ? '正在显示上次成功结果' : '尚无可用数据'}：${result.error}`, true);
    else status(['已同步', ...(result.report.warnings ?? [])].join('\n'), result.report.warnings?.length > 0);
  } catch (e) { status(`无法连接本地采集程序。请按 README 安装后重试。${report ? ' 当前保留上次成功结果。' : ''}\n${e.message}`, true); }
  finally { busy = false; $('refresh').disabled = $('open-dashboard').disabled = false; }
}
$('refresh').onclick = () => refresh(true);
$('open-dashboard').onclick = async () => {
  $('open-dashboard').disabled = true;
  status('正在打开完整分析面板…');
  try {
    const result = await request('dashboard');
    status(result?.ok ? '完整分析面板已在新标签页打开' : `无法打开完整分析面板：${result?.error || '未知错误'}`, !result?.ok);
  } catch (error) { status(`无法打开完整分析面板：${error.message}`, true); }
  finally { $('open-dashboard').disabled = false; }
};
$('quota-bucket').onchange = render;
function selectMetric(metric) {
  activeMetric = metric;
  const panels = { totalTokens: 'token-panel', costUSD: 'cost-panel', heatmap: 'heatmap-panel', quota: 'quota-panel' };
  for (const [value, panel] of Object.entries(panels)) {
    const selected = value === metric;
    $(panel).hidden = !selected;
    const tab = value === 'totalTokens' ? 'tab-tokens' : value === 'costUSD' ? 'tab-cost' : value === 'heatmap' ? 'tab-heatmap' : 'tab-quota';
    $(tab).setAttribute('aria-selected', String(selected)); $(tab).tabIndex = selected ? 0 : -1;
  }
  render();
}
$('tab-tokens').onclick = () => selectMetric('totalTokens');
$('tab-cost').onclick = () => selectMetric('costUSD');
$('tab-heatmap').onclick = () => selectMetric('heatmap');
$('tab-quota').onclick = () => selectMetric('quota');
for (const id of ['tab-tokens', 'tab-cost', 'tab-heatmap', 'tab-quota']) $(id).onkeydown = e => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const metrics = ['totalTokens', 'costUSD', 'heatmap', 'quota'];
    const index = metrics.indexOf(activeMetric);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? metrics.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + metrics.length) % metrics.length;
    const metric = metrics[next];
    selectMetric(metric); $(metric === 'totalTokens' ? 'tab-tokens' : metric === 'costUSD' ? 'tab-cost' : metric === 'heatmap' ? 'tab-heatmap' : 'tab-quota').focus();
  }
};
document.addEventListener('scroll', () => { $('tooltip').hidden = true; }, true);
for (const id of ['range', 'model', 'layout']) $(id).onchange = render;
for (const id of ['from', 'to']) $(id).onchange = () => { $('range').value = 'custom'; render(); };
window.addEventListener('resize', render);
try { const cached = await request('cache'); if (cached.report) useReport(cached.report); } catch { /* 安装提示统一由刷新显示。 */ }
await refresh();
