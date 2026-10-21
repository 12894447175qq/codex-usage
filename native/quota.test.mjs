import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeQuota, weeklySnapshots, readQuota, quotaState } from './quota.mjs';

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

test('实时额度按时长识别主次窗口与独立类别，保留零剩余和零重置', () => {
  const state = quotaState({ rateLimitsByLimitId: {
    codex: { primary: { windowDurationMins: 10080, usedPercent: 10 }, secondary: null, planType: 'prolite' },
    other: { primary: { windowDurationMins: 300, usedPercent: 100, resetsAt: 1792309526 }, individualLimit: { windowDurationMins: 10080, usedPercent: null } },
  }, rateLimitResetCredits: { availableCount: 0, credits: [{ id: 'private-credit' }] } }, '2026-10-12T01:00:00Z');
  assert.equal(state.current.length, 2);
  assert.equal(state.current[0].window, 'weekly');
  assert.equal(state.current[0].remainingPercent, 90);
  assert.equal(state.current[1].remainingPercent, 0);
  assert.equal(state.current[1].resetsAt, '2026-10-18T07:45:26.000Z');
  assert.equal(state.current[0].resetsAvailable, 0);
  assert.doesNotMatch(JSON.stringify(state), /private-credit/);
  assert.throws(() => quotaState({ rateLimitsByLimitId: {} }), /未返回/);
});

test('只有周窗口时不伪造 5 小时窗口，空映射兼容旧接口', () => {
  const state = quotaState({ rateLimitsByLimitId: {}, rateLimits: { primary: { usedPercent: 10, windowDurationMins: 10080 } } });
  assert.deepEqual(state.current.map(item => item.window), ['weekly']);
});

test('旧上游与新实时快照统一类别及重置时间，重复分钟保留最新观测', () => {
  const old = { date: '2026-10-12', capturedAt: '2026-10-12T01:00:01Z', window: 'weekly', limitId: 'weekly', source: 'capisoft', remainingPercent: 95, resetsAt: 1792309526 };
  const live = { ...old, capturedAt: '2026-10-12T01:00:30Z', limitId: 'codex', source: 'codex', remainingPercent: 90, resetsAt: '2026-10-18T07:45:26.000Z' };
  const merged = mergeQuota({ snapshots: [old] }, [live]);
  assert.equal(merged.snapshots.length, 1);
  assert.equal(merged.snapshots[0].remainingPercent, 90);
});
