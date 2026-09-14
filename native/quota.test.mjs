import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuota, weeklySnapshots, readQuota } from './quota.mjs';

test('周窗口按时长识别，保留独立类别；缺失百分比不是零', () => {
  const raw = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: 123 } }, spark: { primary: { usedPercent: 8, windowDurationMins: 300 }, secondary: { usedPercent: 2, windowDurationMins: 10080 } }, unknown: { primary: { usedPercent: null, windowDurationMins: 10080 } } } };
  const rows = weeklySnapshots(raw, '2026-09-14T16:01:00.000Z');
  assert.equal(rows.length, 2); assert.equal(rows[0].remainingPercent, 93);
  assert.equal(rows[0].date, '2026-09-15'); assert.equal(rows[1].limitId, 'spark');
});

test('同一分钟更新，不同分钟、类别和重置周期保留；旧手工数据不丢失', () => {
  const one = { capturedAt: '2026-09-14T03:00:01.000Z', limitId: 'codex', resetsAt: 123, source: 'codex', window: 'weekly', remainingPercent: 95 };
  const old = { ...one, source: 'manual' };
  let history = mergeQuota({ snapshots: [old] }, [one, { ...one, capturedAt: '2026-09-14T03:00:59.000Z', remainingPercent: 93 }]);
  assert.equal(history.snapshots.length, 2);
  assert.equal(history.snapshots.at(-1).remainingPercent, 93);
  history = mergeQuota(history, [{ ...one, capturedAt: '2026-09-14T03:01:00.000Z' }, { ...one, limitId: 'spark' }, { ...one, resetsAt: 456 }]);
  assert.equal(history.snapshots.length, 5);
});

test('Codex 不存在时返回明确错误', async () => {
  await assert.rejects(readQuota({ bin: '/nonexistent/codex' }), /无法启动/);
});
