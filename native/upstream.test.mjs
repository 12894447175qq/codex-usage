import test from 'node:test';
import assert from 'node:assert/strict';
import { reportFromUsage } from './upstream.mjs';

test('capisoft 数据转换为按天模型统计和双额度窗口', () => {
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
  assert.equal('costUSD' in model, false);
  assert.equal('pricingCatalogVersion' in report, false);
  assert.equal('heatmap' in report, false);
  assert.equal(report.schemaVersion, 6);
  assert.equal(report.quota.weekly[0].remainingPercent, 93);
  assert.equal(report.quota.fiveHour[0].remainingPercent, 88);
});

test('未知模型保留 Token 和调用次数', () => {
  const report = reportFromUsage({
    apiVersion: 1,
    sessions: [{ calls: [{ timestamp: '2026-09-14T01:00:00.000Z', model: 'future-model', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }] }],
  }, { syncedAt: '2026-09-14T01:00:00.000Z' });
  assert.equal(report.days[0].models[0].totalTokens, 15);
  assert.equal(report.days[0].models[0].calls, 1);
});


test('不同速度档均保留 Token，缺失时间不落入 1970 年', () => {
  const call = { timestamp: '2026-09-14T16:00:00.000Z', model: 'gpt-5.3-codex', serviceTier: 'standard', usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } };
  const mixed = reportFromUsage({ apiVersion: 1, sessions: [{ calls: [call, { ...call, serviceTier: 'unsupported' }, { ...call, timestamp: null }, { ...call, timestamp: 'invalid' }] }] });
  const model = mixed.days[0].models[0];
  assert.equal(mixed.days[0].date, '2026-09-15');
  assert.equal('knownCostUSD' in model, false);
  assert.equal('unknownCostCalls' in model, false);
  assert.equal(model.calls, 2);
  assert.equal(model.totalTokens, 220);
  assert.equal(mixed.upstream.skippedCalls, 2);
});


test('新模型标准与 Fast 调用统一聚合 Token，不生成费用字段', () => {
  const models = ['gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol'];
  const calls = models.flatMap(model => ['default', 'priority'].map(serviceTier => ({ timestamp: '2026-10-12T01:00:00Z', model, serviceTier, usage: { inputTokens: 100, cachedInputTokens: 50, outputTokens: 10, totalTokens: 110 } })));
  const report = reportFromUsage({ apiVersion: 1, sessions: [{ calls }] });
  assert.equal('pricingSource' in report, false);
  for (const model of report.days[0].models) {
    assert.equal(model.calls, 2);
    assert.equal(model.totalTokens, 220);
    assert.ok(['costUSD', 'knownCostUSD', 'costKnown', 'unknownCostCalls'].every(key => !(key in model)));
  }
});
