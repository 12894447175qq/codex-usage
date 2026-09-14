import test from 'node:test';
import assert from 'node:assert/strict';
import { reportFromUsage } from './upstream.mjs';

test('capisoft 数据转换为按天模型统计、小时热力图和双额度窗口', () => {
  const usage = {
    apiVersion: 1,
    analyzerVersion: 10,
    generatedAt: '2026-09-14T01:05:00.000Z',
    errorCount: 0,
    sessions: [{
      calls: [{
        timestamp: '2026-09-14T01:00:00.000Z',
        model: 'gpt-5.3-codex',
        effort: 'medium',
        serviceTier: 'standard',
        usage: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10, totalTokens: 110 },
      }],
    }],
    fiveHourQuota: { usedPercent: 12, observedAt: '2026-09-14T01:05:00.000Z', resetsAt: '2026-09-14T06:00:00.000Z' },
    weeklyQuota: { usedPercent: 7, observedAt: '2026-09-14T01:05:00.000Z', resetsAt: '2026-09-21T01:05:00.000Z' },
    weeklyQuotaHistory: [],
  };
  const report = reportFromUsage(usage, { version: '1.5.1', syncedAt: '2026-09-14T01:06:00.000Z' });
  const model = report.days[0].models[0];
  assert.equal(report.days[0].date, '2026-09-14');
  assert.equal(model.inputTokens, 80);
  assert.equal(model.cacheReadTokens, 20);
  assert.equal(model.outputTokens, 10);
  assert.equal(model.totalTokens, 110);
  assert.equal(model.calls, 1);
  assert.equal(typeof model.costUSD, 'number');
  assert.equal(report.heatmap.hours[9].models[0].totalTokens, 110);
  assert.equal(report.quota.weekly[0].remainingPercent, 93);
  assert.equal(report.quota.fiveHour[0].remainingPercent, 88);
});

test('未知模型保留 Token，并把费用标记为未知', () => {
  const report = reportFromUsage({
    apiVersion: 1,
    sessions: [{ calls: [{ timestamp: '2026-09-14T01:00:00.000Z', model: 'future-model', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }] }],
  }, { syncedAt: '2026-09-14T01:00:00.000Z' });
  assert.equal(report.days[0].models[0].totalTokens, 15);
  assert.equal(report.days[0].models[0].costUSD, null);
});
