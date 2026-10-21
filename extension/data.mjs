const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

export function selectDays(report, from, to, model = 'all') {
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('请选择有效的起止日期');
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (count > 3660) throw new Error('单次图表请选择不超过十年的范围');
  const stored = new Map(report.days.map(day => [day.date, day]));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10);
    return { date, models: (stored.get(date)?.models ?? []).filter(row => model === 'all' || row.model === model) };
  });
}

export function summarize(rows) {
  return {
    tokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
  };
}

export function formatTokens(value) {
  const unit = value >= 1e8 ? '亿' : value >= 1e4 ? '万' : '';
  const divisor = unit === '亿' ? 1e8 : unit === '万' ? 1e4 : 1;
  return (value / divisor).toLocaleString('zh-CN', { maximumFractionDigits: unit ? 2 : 0 }) + (unit ? ` ${unit}` : '');
}

export function quotaObservation(snapshot, now = Date.now()) {
  const captured = Date.parse(snapshot?.capturedAt);
  const reset = typeof snapshot?.resetsAt === 'number' ? snapshot.resetsAt * 1000 : Date.parse(snapshot?.resetsAt);
  if (!Number.isFinite(captured)) return '采集时间未知';
  if (Number.isFinite(reset) && reset <= now) return '周期已结束，请刷新';
  if (now - captured > 15 * 60_000) return '观测已超过 15 分钟，请刷新';
  return '最近观测';
}

const quotaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const resetTime = value => typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;

export function quotaTimeline(snapshots, from, to) {
  if (!validDate(from) || !validDate(to) || from > to) throw new Error('请选择有效的起止日期');
  const start = Date.parse(`${from}T00:00:00+08:00`);
  const end = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
  const points = snapshots.flatMap(snapshot => {
    const time = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(time) || time < start || time >= end || !Number.isFinite(snapshot.remainingPercent) || snapshot.remainingPercent < 0 || snapshot.remainingPercent > 100) return [];
    return [{ ...snapshot, time, date: quotaDate.format(new Date(time)) }];
  }).sort((a, b) => a.time - b.time);
  points.forEach((point, index) => {
    const previous = points[index - 1];
    const reset = resetTime(point.resetsAt), previousReset = resetTime(previous?.resetsAt);
    const knownReset = Number.isFinite(reset), knownPreviousReset = Number.isFinite(previousReset);
    // 接口重置时间可能有一秒的舍入差异，不能因此把同周期画断。
    point.startsNewCycle = Boolean(previous && knownReset && knownPreviousReset && Math.abs(reset - previousReset) > 1000);
    const unknownBoundary = knownReset !== knownPreviousReset;
    const missingDay = previous && (Date.parse(point.date) - Date.parse(previous.date)) / 86400000 > 1;
    point.breakBefore = !previous || point.startsNewCycle || unknownBoundary || Boolean(missingDay);
  });
  return {
    points,
    startTime: from === to && points.length ? points[0].time : start,
    endTime: from === to && points.length ? points.at(-1).time : end - 1,
  };
}
