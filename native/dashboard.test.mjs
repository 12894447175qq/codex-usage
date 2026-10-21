import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDays, summarize, formatTokens, quotaObservation, quotaTimeline } from '../extension/data.mjs';
import { createTokenScale } from '../extension/token-scale.mjs';

const row = { model: 'known', inputTokens: 60, cacheReadTokens: 30, cacheCreationTokens: 10, outputTokens: 5, totalTokens: 105, costUSD: null, knownCostUSD: .25, unknownCostCalls: 1, calls: 2 };

test('筛选包含北京时间边界、缺失日期和模型，拒绝非法日期和超大范围', () => {
  const report = { days: [{ date: '2026-10-01', models: [row, { ...row, model: 'other' }] }, { date: '2026-10-03', models: [row] }] };
  const days = selectDays(report, '2026-10-01', '2026-10-03', 'known');
  assert.deepEqual(days.map(day => day.models.length), [1, 0, 1]);
  assert.throws(() => selectDays(report, '2026-02-30', '2026-03-01'), /有效/);
  assert.throws(() => selectDays(report, '2026-10-03', '2026-10-01'), /有效/);
  assert.throws(() => selectDays(report, '2000-01-01', '2026-10-01'), /十年/);
});

test('仅汇总 Token，移除调用次数、缓存占比和费用派生字段', () => {
  const summary = summarize([row, { ...row, costUSD: .5, knownCostUSD: undefined }]);
  assert.equal('cost' in summary, false);
  assert.equal('incomplete' in summary, false);
  assert.deepEqual(summary, { tokens: 210 });
  assert.deepEqual(summarize([]), { tokens: 0 });
});

test('小额 Token 保留可读精度，不显示为 0.00 亿', () => {
  assert.equal(formatTokens(105), '105');
  assert.equal(formatTokens(12345), '1.23 万');
  assert.equal(formatTokens(123456789), '1.23 亿');
});

test('额度区分最近观测、过期快照及已结束周期，支持两种重置时间格式', () => {
  const now = Date.parse('2026-10-12T04:00:00Z');
  const snapshot = { capturedAt: '2026-10-12T03:59:00Z', resetsAt: '2026-10-12T05:00:00Z' };
  assert.equal(quotaObservation(snapshot, now), '最近观测');
  assert.match(quotaObservation({ ...snapshot, capturedAt: '2026-10-12T03:00:00Z' }, now), /15 分钟/);
  assert.match(quotaObservation({ ...snapshot, resetsAt: now / 1000 }, now), /周期已结束/);
  assert.match(quotaObservation({ ...snapshot, resetsAt: '2026-10-12T03:59:59Z' }, now), /周期已结束/);
  assert.match(quotaObservation({}, now), /时间未知/);
});

const quotaPoint = (capturedAt, remainingPercent, resetsAt = '2026-10-27T06:00:00Z') => ({ capturedAt, remainingPercent, resetsAt, limitId: 'codex', window: 'weekly' });

test('7 天额度保留同日重置前后全部观测，100% 到晚间 90% 不被每日最后一条覆盖', () => {
  const before = quotaPoint('2026-10-20T13:59:00+08:00', 10, '2026-10-26T06:00:00Z');
  const reset = quotaPoint('2026-10-20T14:00:00+08:00', 100);
  const evening = quotaPoint('2026-10-20T21:00:00+08:00', 90);
  const today = quotaPoint('2026-10-21T09:00:00+08:00', 85);
  const source = [today, before, evening, reset].map(Object.freeze);
  const result = quotaTimeline(source, '2026-10-15', '2026-10-21');
  assert.deepEqual(result.points.map(point => point.remainingPercent), [10, 100, 90, 85]);
  assert.deepEqual(result.points.map(point => point.breakBefore), [true, true, false, false]);
  assert.deepEqual(result.points.map(point => point.startsNewCycle), [false, true, false, false]);
  assert.equal(result.startTime, Date.parse('2026-10-15T00:00:00+08:00'));
  assert.equal(result.endTime, Date.parse('2026-10-22T00:00:00+08:00') - 1);
  assert.ok(result.points[1].time < result.points[2].time);
  assert.equal(source[0].time, undefined, '绘图不得修改真实快照');
});

test('按采集时间和北京时间日期筛选，保留 10→90→70，未采到 100 时不补造', () => {
  const source = [quotaPoint('2026-10-20T00:00:00+08:00', 10), quotaPoint('2026-10-20T14:33:00+08:00', 99), quotaPoint('2026-10-20T20:00:00+08:00', 90), quotaPoint('2026-10-20T22:00:00+08:00', 70), quotaPoint('2026-10-21T00:00:00+08:00', 69), quotaPoint('bad', 100), quotaPoint('2026-10-20T10:00:00+08:00', NaN), quotaPoint('2026-10-20T11:00:00+08:00', 101)];
  source[0].date = '2026-10-19';
  const result = quotaTimeline(source, '2026-10-20', '2026-10-20');
  assert.deepEqual(result.points.map(point => point.remainingPercent), [10, 99, 90, 70]);
  assert.ok(result.points.every(point => point.date === '2026-10-20'));
  assert.ok(result.points.slice(1).every(point => !point.breakBefore), '比例回升本身不是重置证据');
  assert.equal(result.startTime, Date.parse(source[0].capturedAt));
  assert.equal(result.endTime, Date.parse(source[3].capturedAt));
  const nonmonotonic = quotaTimeline([quotaPoint('2026-10-20T10:00:00+08:00', 10), quotaPoint('2026-10-20T11:00:00+08:00', 90), quotaPoint('2026-10-20T12:00:00+08:00', 70)], '2026-10-20', '2026-10-20');
  assert.deepEqual(nonmonotonic.points.map(point => point.remainingPercent), [10, 90, 70]);
});

test('同周期重置时间的一秒差异不断线，真实换周期和缺失日期断线', () => {
  const source = [quotaPoint('2026-10-18T12:00:00+08:00', 80), quotaPoint('2026-10-18T20:00:00+08:00', 70, Date.parse('2026-10-27T06:00:01Z') / 1000), quotaPoint('2026-10-20T10:00:00+08:00', 60), quotaPoint('2026-10-20T14:00:00+08:00', 100, '2026-10-28T06:00:00Z')];
  const result = quotaTimeline(source, '2026-10-15', '2026-10-21');
  assert.deepEqual(result.points.map(point => point.breakBefore), [true, false, true, true]);
  assert.deepEqual(result.points.map(point => point.startsNewCycle), [false, false, false, true]);
});

test('空额度、单点及缺失周期信息正常处理，拒绝非法日期', () => {
  assert.deepEqual(quotaTimeline([], '2026-10-20', '2026-10-20').points, []);
  const one = quotaTimeline([quotaPoint('2026-10-20T14:00:00+08:00', 0, null)], '2026-10-20', '2026-10-20');
  assert.equal(one.startTime, one.endTime);
  assert.equal(one.points[0].remainingPercent, 0);
  const mixed = quotaTimeline([quotaPoint('2026-10-20T14:00:00+08:00', 100, null), quotaPoint('2026-10-20T15:00:00+08:00', 90, null), quotaPoint('2026-10-20T16:00:00+08:00', 80)], '2026-10-20', '2026-10-20');
  assert.deepEqual(mixed.points.map(point => point.breakBefore), [true, false, true]);
  assert.throws(() => quotaTimeline([], '2026-02-30', '2026-10-21'), /有效/);
});

test('断轴只压缩无观测值的大跨度区间，最多两处，映射单调并保留小模型可读高度', () => {
  const values = [0, 100, 200, 100_000, 110_000, 10_000_000, 12_000_000];
  const scale = createTokenScale(values, 180);
  assert.equal(scale.breaks.length, 2);
  assert.ok(scale.map(100) > 15);
  assert.ok(scale.map(200) > scale.map(100));
  assert.equal(scale.map(0), 0);
  assert.equal(scale.map(scale.max), 180);
  for (const gap of scale.breaks) assert.ok(values.every(value => value <= gap.start || value >= gap.end));
  const samples = [...values, ...scale.breaks.flatMap(gap => [gap.start, (gap.start + gap.end) / 2, gap.end]), scale.max].sort((a, b) => a - b);
  samples.forEach((value, index) => { if (index) assert.ok(scale.map(value) >= scale.map(samples[index - 1])); });
  const expanded = createTokenScale(values, 180, true);
  assert.equal(expanded.breaks.length, 0);
  assert.equal(expanded.availableBreaks.length, 2);
  assert.equal(expanded.map(100), 100 / expanded.max * 180);
  // 周数据往往有中间模型填补数量级差异，仍需识别约三倍的空白区间。
  const weekly = createTokenScale([900_000, 960_000, 1_000_000, 1_050_000, 1_900_000, 5_900_000, 6_100_000, 7_800_000, 8_200_000, 12_000_000, 34_000_000, 43_000_000, 59_000_000, 80_000_000, 91_000_000, 137_000_000, 139_000_000], 142);
  assert.equal(weekly.breaks.length, 1);
  assert.ok(weekly.map(900_000) > 15);
});

test('相近值、单柱、空数据和非法值无需断轴；堆叠累计边界不落入断轴内部', () => {
  for (const values of [[], [0], [1], [100], [100, 200, 300], [NaN, Infinity, -1, 0]]) {
    const scale = createTokenScale(values, 180);
    assert.equal(scale.breaks.length, 0);
    assert.ok(Number.isFinite(scale.max));
    assert.ok(Number.isFinite(scale.map(0)));
  }
  const totals = [100, 100 + 10_000_000, 200, 200 + 12_000_000];
  const scale = createTokenScale(totals, 180);
  assert.equal(scale.breaks.length, 1);
  assert.ok(scale.map(totals[1]) - scale.map(totals[0]) > 0);
  assert.equal(scale.map(totals[1]) - scale.map(totals[0]) + scale.map(totals[0]), scale.map(totals[1]));
});
