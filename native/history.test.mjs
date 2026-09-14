import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaSnapshot, mergeDays, migrateReport, upsertQuotaSnapshot } from './history.mjs';

const day = (date, totalTokens, sourceVersion = '1.0.0') => ({ date, totalTokens, models: [], sourceVersion });

test('历史账本保留旧日期，并用新采集结果覆盖相同日期', () => {
  const merged = mergeDays([day('2026-09-08', 8), day('2026-09-09', 9)], [day('2026-09-09', 99)], '2.0.0');
  assert.deepEqual(merged.map(item => item.date), ['2026-09-08', '2026-09-09']);
  assert.equal(merged[0].totalTokens, 8);
  assert.equal(merged[1].totalTokens, 99);
  assert.equal(merged[1].sourceVersion, '2.0.0');
});
test('旧报告可以迁移为本地历史账本', () => {
  const history = migrateReport({ version: '3.0.0', syncedAt: '2026-09-09T10:00:00.000Z', days: [day('2026-09-09', 9)] });
  assert.equal(history.schemaVersion, 1);
  assert.equal(history.timezone, 'Asia/Shanghai');
  assert.equal(history.days[0].sourceVersion, '3.0.0');
});

test('额度快照按北京时间日期和窗口去重，并校验范围', () => {
  const first = createQuotaSnapshot({ date: '2026-09-09', capturedAt: '2026-09-09T01:00:00.000Z', remainingPercent: 95 });
  const latest = createQuotaSnapshot({ date: '2026-09-09', capturedAt: '2026-09-09T02:00:00.000Z', remainingPercent: 92.5 });
  const history = upsertQuotaSnapshot(upsertQuotaSnapshot(null, first), latest);
  assert.equal(history.snapshots.length, 1);
  assert.equal(history.snapshots[0].remainingPercent, 92.5);
  assert.throws(() => createQuotaSnapshot({ date: '2026-09-09', remainingPercent: 101 }), /0 到 100/);
  assert.throws(() => createQuotaSnapshot({ date: '2026-09-09', window: 'five-hour', remainingPercent: 95 }), /周额度/);
});
