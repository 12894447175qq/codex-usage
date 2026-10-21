// 只折叠没有柱顶/堆叠边界落入的大跨度区间，数据本身不变。
// 每段保留独立线性刻度；断轴用显式锯齿和边界数值标明。
export function createTokenScale(values, height, expanded = false) {
  const sorted = [...new Set(values.filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  const peak = sorted.at(-1) ?? 0;
  const step = peak ? 10 ** Math.floor(Math.log10(peak)) / 2 : 1;
  const max = peak ? Math.ceil(peak * 1.05 / step) * step : 1;
  const candidates = [];
  for (let i = 1; i < sorted.length; i++) {
    const low = sorted[i - 1], high = sorted[i];
    if (high / low < 3) continue;
    const startStep = Math.max(1, 10 ** Math.floor(Math.log10(low)) / 5);
    const endStep = Math.max(1, 10 ** Math.floor(Math.log10(high)) / 5);
    const start = Math.ceil(low * 1.15 / startStep) * startStep;
    const end = Math.floor(high * .85 / endStep) * endStep;
    if (start < end) candidates.push({ start, end, ratio: high / low });
  }
  const availableBreaks = candidates.sort((a, b) => b.ratio - a.ratio).slice(0, 2).sort((a, b) => a.start - b.start);
  const breaks = expanded ? [] : availableBreaks;
  const bands = [];
  let start = 0;
  for (const item of breaks) { bands.push({ start, end: item.start }); start = item.end; }
  bands.push({ start, end: max });
  const gap = 10;
  const bandHeight = (height - breaks.length * gap) / bands.length;
  bands.forEach((band, index) => { band.bottom = index * (bandHeight + gap); band.top = band.bottom + bandHeight; });
  const map = value => {
    value = Math.max(0, Math.min(max, value));
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      if (value <= band.end) return band.bottom + (value - band.start) / (band.end - band.start) * bandHeight;
      if (i < breaks.length && value < breaks[i].end) return band.top + (value - breaks[i].start) / (breaks[i].end - breaks[i].start) * gap;
    }
    return height;
  };
  const ticks = breaks.length
    ? bands.flatMap(band => [band.start, ...(bandHeight >= 70 ? [(band.start + band.end) / 2] : []), band.end])
    : Array.from({ length: 5 }, (_, i) => max * i / 4);
  return { max, map, ticks, breaks, availableBreaks, bands };
}
