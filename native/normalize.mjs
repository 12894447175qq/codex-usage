const tokenKeys = ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens'];
const number = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`无效数值：${name}`);
  return v;
};
const close = (a, b) => Math.abs(a - b) <= Math.max(1e-7, Math.abs(b) * 1e-9);

// 只保留 Codex 聚合值，不向扩展传递其他代理或会话正文。
export function normalize(raw) {
  if (!Array.isArray(raw.daily)) throw new Error('ccusage 输出不兼容：缺少 daily');
  const dates = new Set();
  const days = [];
  for (const row of raw.daily) {
    const date = row.period ?? row.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || dates.has(date)) throw new Error('日期无效或重复');
    dates.add(date);
    if (!Array.isArray(row.agents)) throw new Error('ccusage 输出不兼容：缺少 agents');
    const matches = row.agents.filter(a => a.agent === 'codex');
    if (matches.length > 1) throw new Error('Codex 分组重复');
    if (!matches.length) continue;
    const a = matches[0];
    if (!Array.isArray(a.modelBreakdowns)) throw new Error('缺少模型费用明细');
    const names = new Set();
    const models = a.modelBreakdowns.map(m => {
      if (typeof m.modelName !== 'string' || !m.modelName || names.has(m.modelName)) throw new Error('模型名称无效或重复');
      names.add(m.modelName);
      const out = { model: m.modelName };
      for (const k of tokenKeys) {
        out[k] = number(m[k], k);
        if (!Number.isSafeInteger(out[k])) throw new Error('Token 必须是安全整数');
      }
      out.totalTokens = tokenKeys.reduce((sum, k) => sum + out[k], 0);
      const cost = m.cost == null ? null : number(m.cost, 'cost');
      // 有消耗却返回零价时保守视为未知，避免新模型被误报为免费。
      out.costUSD = m.missingPricing || m.isFallback || (cost === 0 && out.totalTokens > 0) ? null : cost;
      return out;
    });
    for (const k of [...tokenKeys, 'totalTokens']) {
      if (!close(models.reduce((s, m) => s + m[k], 0), number(a[k], k))) throw new Error(`模型与每日 ${k} 汇总不一致`);
    }
    const incomplete = models.some(m => m.costUSD === null);
    const costUSD = models.reduce((s, m) => s + (m.costUSD ?? 0), 0);
    if (!incomplete && !close(costUSD, number(a.totalCost, 'totalCost'))) throw new Error('模型与每日费用汇总不一致');
    days.push({ date, models, totalTokens: a.totalTokens, costUSD, incomplete });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}
