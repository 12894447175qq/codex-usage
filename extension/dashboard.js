const $ = id => document.getElementById(id);
const palette = ['#23795c', '#6695cd', '#b29a58', '#906eb9', '#d58562', '#5ca5ac'];
const fmt = n => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n);
const usd = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
let report, colors = new Map(), busy = false;
const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
async function request(type, force = false) {
  return chrome.runtime.sendMessage({ type, force });
}
function useReport(value) {
  report = value;
  const selected = $('model').value;
  const names = [...new Set(report.days.flatMap(d => d.models.map(m => m.model)))].sort();
  colors = new Map(names.map((name, i) => [name, palette[i % palette.length]]));
  $('model').replaceChildren(new Option('全部模型', 'all'), ...names.map(n => new Option(n, n)));
  if (names.includes(selected)) $('model').value = selected;
  render();
  $('meta').textContent = `最后成功同步：${new Date(report.syncedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · ccusage ${report.version} · ${report.pricingSource}。仅覆盖本地保留的日志；每个北京时间自然日首次同步检查更新。统一报表会探测本机其他代理，但本扩展仅保存 Codex 聚合数据。`;
}
function dates() {
  const range = $('range').value;
  if (range !== 'custom') {
    const end = today();
    const start = new Date(`${end}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (Number(range) - 1));
    $('from').value = range === 'all' ? report?.days[0]?.date ?? end : start.toISOString().slice(0, 10);
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
  if (!days.length || !names.length) { container.append(node('div', '所选范围没有记录')); return; }
  const grouped = $('layout').value === 'grouped';
  const width = Math.max(340, container.clientWidth, days.length * Math.max(18, grouped ? names.length * 12 + 10 : 18));
  const svg = svgNode('svg', { width, height: 180, viewBox: `0 0 ${width} 180`, role: 'img', 'aria-label': metric === 'totalTokens' ? '每日模型 Token 柱状图，详细数据见下方表格' : '每日模型估算费用柱状图，详细数据见下方表格' });
  const values = days.map(d => d.models.map(m => m[metric] ?? 0));
  const max = Math.max(1, ...values.map(v => grouped ? Math.max(0, ...v) : v.reduce((a, b) => a + b, 0)));
  const left = 68, height = 125, slot = (width - left - 15) / days.length;
  for (let i = 0; i <= 4; i++) {
    const y = 18 + height * i / 4;
    svg.append(svgNode('line', { x1: left, x2: width - 10, y1: y, y2: y, stroke: '#e8eee8' }));
    const val = max * (1 - i / 4);
    const label = metric === 'costUSD' ? `$${val.toFixed(2)}` : val >= 1e6 ? `${(val / 1e6).toFixed(1)}M` : fmt(val);
    svg.append(svgNode('text', { x: left - 10, y: y + 4, 'text-anchor': 'end' }, label));
  }
  days.forEach((d, i) => {
    let offset = 0;
    names.forEach((name, j) => {
      const m = d.models.find(m => m.model === name); if (!m) return;
      const value = m[metric];
      if (value === null) {
        svg.append(svgNode('text', { x: left + slot * (i + .5), y: 156, 'text-anchor': 'middle' }, '?'));
        return;
      }
      const h = value / max * height;
      const barWidth = grouped ? slot * .76 / names.length : slot * .64;
      const x = left + slot * i + slot * .15 + (grouped ? j * barWidth : 0);
      const rect = svgNode('rect', { x, y: 18 + height - h - (grouped ? 0 : offset), width: Math.max(1, barWidth - 1), height: h, fill: colors.get(name), rx: 2, tabindex: 0 });
      const label = `${d.date} · ${name}\n输入 ${fmt(m.inputTokens)} · 缓存读取 ${fmt(m.cacheReadTokens)} · 缓存写入 ${fmt(m.cacheCreationTokens)} · 输出 ${fmt(m.outputTokens)}\nToken ${fmt(m.totalTokens)} · 估算费用 ${m.costUSD === null ? '未知' : '$' + usd(m.costUSD)}`;
      rect.append(svgNode('title', {}, label)); rect.setAttribute('aria-label', label);
      svg.append(rect); if (!grouped) offset += h;
    });
    if (i % Math.max(1, Math.ceil(days.length / (width / 65))) === 0) svg.append(svgNode('text', { x: left + slot * (i + .5), y: 175, 'text-anchor': 'middle' }, d.date.slice(5)));
  });
  container.append(svg);
}
function render() {
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
  $('tokens').textContent = fmt(rows.reduce((s, m) => s + m.totalTokens, 0));
  $('cost').textContent = '$' + usd(rows.reduce((s, m) => s + (m.costUSD ?? 0), 0)) + (rows.some(m => m.costUSD === null) ? ' + 未知' : '');
  $('models').textContent = names.length;
  $('legend').replaceChildren(...names.map(name => { const item = node('span'); const dot = node('i'); dot.className = 'dot'; dot.style.background = colors.get(name); item.append(dot, document.createTextNode(name)); return item; }));
  chart('token-chart', days, names, 'totalTokens'); chart('cost-chart', days, names, 'costUSD');
  $('details').replaceChildren(...rows.reverse().map(m => { const tr = node('tr'); tr.append(...[m.date, m.model, fmt(m.inputTokens), fmt(m.cacheReadTokens), fmt(m.cacheCreationTokens), fmt(m.outputTokens), fmt(m.totalTokens), m.costUSD === null ? '未知' : usd(m.costUSD)].map(v => node('td', v))); return tr; }));
}
async function refresh(force = false) {
  if (busy) return; busy = true; $('refresh').disabled = $('update').disabled = true;
  status(force ? '正在检查新版并校验数据…' : '正在读取本机用量，首次运行可能需要下载 ccusage…');
  try {
    const result = await request('sync', force);
    if (result.report) useReport(result.report);
    if (!result.ok) status(`同步失败，${report ? '正在显示上次成功结果' : '尚无可用数据'}：${result.error}`, true);
    else status(['同步完成 · 费用为估算值', ...(result.report.warnings ?? [])].join('\n'), result.report.warnings?.length > 0);
  } catch (e) { status(`无法连接本地采集程序。请按 README 安装后重试。${report ? ' 当前保留上次成功结果。' : ''}\n${e.message}`, true); }
  finally { busy = false; $('refresh').disabled = $('update').disabled = false; }
}
$('refresh').onclick = () => refresh(); $('update').onclick = () => refresh(true);
for (const id of ['range', 'model', 'layout']) $(id).onchange = render;
for (const id of ['from', 'to']) $(id).onchange = () => { $('range').value = 'custom'; render(); };
window.addEventListener('resize', render);
try { const cached = await request('cache'); if (cached.report) useReport(cached.report); } catch { /* 安装提示统一由刷新显示。 */ }
await refresh();
