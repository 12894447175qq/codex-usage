import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';

function fixture() {
  return { daily: [{ period: '2026-09-09', agents: [{ agent: 'codex', inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 0, outputTokens: 5, totalTokens: 35, totalCost: .1, modelBreakdowns: [{ modelName: 'test-model', inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 0, outputTokens: 5, cost: .1 }] }, { agent: 'claude', totalTokens: 999 }] }] };
}
test('仅提取 Codex，缓存只计一次', () => {
  const days = normalize(fixture()); assert.equal(days[0].totalTokens, 35); assert.equal(days[0].models.length, 1); assert.equal(days[0].models[0].costUSD, .1);
});
test('缺少价格与有消耗的零价格保留 Token 并标未知', () => {
  for (const cost of [undefined, 0]) { const f = fixture(); f.daily[0].agents[0].modelBreakdowns[0].cost = cost; const d = normalize(f)[0]; assert.equal(d.incomplete, true); assert.equal(d.models[0].costUSD, null); assert.equal(d.totalTokens, 35); }
});
test('拒绝模型费用或 Token 汇总不一致', () => {
  const f = fixture(); f.daily[0].agents[0].totalCost = 2; assert.throws(() => normalize(f), /费用汇总/);
  const g = fixture(); g.daily[0].agents[0].totalTokens = 50; assert.throws(() => normalize(g), /汇总不一致/);
});
test('拒绝输出格式变化、负值、重复日期及模型', () => {
  assert.throws(() => normalize({}));
  const f = fixture(); f.daily.push(f.daily[0]); assert.throws(() => normalize(f), /日期/);
  const g = fixture(); g.daily[0].agents[0].modelBreakdowns[0].inputTokens = -1; assert.throws(() => normalize(g), /无效数值/);
  const h = fixture(); h.daily[0].agents[0].modelBreakdowns.push(h.daily[0].agents[0].modelBreakdowns[0]); assert.throws(() => normalize(h), /模型名称/);
});
test('未知模型标识按纯数据保留，缺少 agents 不静默清空', () => {
  const f = fixture(); f.daily[0].agents[0].modelBreakdowns[0].modelName = '<img onerror=alert(1)>';
  assert.equal(normalize(f)[0].models[0].model, '<img onerror=alert(1)>');
  assert.throws(() => normalize({ daily: [{ period: '2026-09-09' }] }), /agents/);
});
