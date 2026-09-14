const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// 以日期为键合并结果；本次采集到的日期可以覆盖旧值，其他历史日期保持本地账本内容。
export function mergeDays(existing, incoming, sourceVersion) {
  const days = new Map((Array.isArray(existing) ? existing : []).filter(day => validDate(day?.date)).map(day => [day.date, day]));
  for (const day of Array.isArray(incoming) ? incoming : []) {
    if (!validDate(day?.date)) continue;
    days.set(day.date, sourceVersion ? { ...day, sourceVersion } : day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function migrateReport(report) {
  return {
    schemaVersion: 1,
    timezone: 'Asia/Shanghai',
    updatedAt: report?.syncedAt ?? null,
    days: mergeDays([], report?.days, report?.version),
  };
}

function snapshotDate(value) {
  if (!validDate(value)) throw new Error('额度快照日期无效');
  return value;
}

export function createQuotaSnapshot({ date, capturedAt, window = 'weekly', remainingPercent }) {
  if (window !== 'weekly') throw new Error('暂仅支持周额度快照');
  const remaining = Number(remainingPercent);
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) throw new Error('剩余比例必须是 0 到 100 之间的数字');
  const captured = capturedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(captured))) throw new Error('额度快照时间无效');
  return {
    date: snapshotDate(date),
    capturedAt: new Date(captured).toISOString(),
    window,
    remainingPercent: Math.round(remaining * 100) / 100,
    source: 'manual',
  };
}

// 每个北京时间自然日和额度窗口只保留最后一次记录，避免重复打开浮窗产生噪声。
export function upsertQuotaSnapshot(history, snapshot) {
  const snapshots = Array.isArray(history?.snapshots) ? history.snapshots : [];
  const key = `${snapshot.window}:${snapshot.date}`;
  const next = snapshots.filter(item => `${item?.window}:${item?.date}` !== key);
  next.push(snapshot);
  next.sort((a, b) => `${a.date}:${a.capturedAt}`.localeCompare(`${b.date}:${b.capturedAt}`));
  return { schemaVersion: 1, snapshots: next };
}
