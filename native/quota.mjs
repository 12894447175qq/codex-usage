import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// 只调用状态读取接口，不创建任务，也不读取或传输登录凭据。
const bundledBins = ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/ChatGPT.app/Contents/Resources/codex', '/Applications/Codex.app/Contents/Resources/codex'];
export function readQuota({ bin = process.env.CODEX_USAGE_CODEX_BIN || bundledBins.find(existsSync) || 'codex', timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '', done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer); child.kill();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('额度读取超时')), timeout);
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.on('error', () => finish(new Error('无法启动 Codex，请安装并登录 Codex')));
    child.stdin.on('error', () => finish(new Error('Codex 状态连接已关闭')));
    child.on('exit', () => finish(new Error('Codex 状态进程提前退出')));
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2000000) return finish(new Error('Codex 状态响应过大'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (![1, 2].includes(message.id)) continue;
        if (message.error) return finish(new Error('Codex 额度接口不可用，请检查登录状态或更新 Codex'));
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read', params: {} });
        } else finish(null, message.result);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'codex_usage_edge', version: '0.7.0' }, capabilities: { experimentalApi: true } } });
  });
}

export function quotaState(raw, capturedAt = new Date().toISOString()) {
  const mapped = raw?.rateLimitsByLimitId;
  const buckets = mapped && Object.keys(mapped).length ? mapped : raw?.rateLimits ? { [raw.rateLimits.limitId || 'codex']: raw.rateLimits } : {};
  if (!Object.keys(buckets).length) throw new Error('额度接口未返回账户窗口，请检查登录状态');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(capturedAt));
  const current = [];
  const resets = raw?.rateLimitResetCredits?.availableCount;
  for (const [limitId, bucket] of Object.entries(buckets)) {
    for (const value of [bucket?.primary, bucket?.secondary, bucket?.individualLimit]) {
      const window = value?.windowDurationMins === 10080 ? 'weekly' : value?.windowDurationMins === 300 ? 'five-hour' : null;
      if (!window || typeof value.usedPercent !== 'number' || !Number.isFinite(value.usedPercent)) continue;
      if (current.some(item => item.limitId === limitId && item.window === window)) continue;
      const name = window === 'weekly' ? '每周额度' : '5 小时额度';
      current.push({ date, capturedAt, window, limitId, limitName: limitId === 'codex' ? name : `${bucket.limitName || limitId} · ${name}`,
        remainingPercent: Math.max(0, Math.min(100, 100 - value.usedPercent)),
        resetsAt: normalizeReset(value.resetsAt), planType: bucket.planType ?? null,
        resetsAvailable: Number.isSafeInteger(resets) && resets >= 0 ? resets : null, source: 'codex' });
    }
  }
  if (!current.length) throw new Error('额度接口未返回有效的剩余比例，保留历史观测');
  return { current, checkedAt: capturedAt, error: null };
}

export const weeklySnapshots = (raw, capturedAt) => quotaState(raw, capturedAt).current.filter(item => item.window === 'weekly');

function normalizeReset(value) {
  const time = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function mergeQuota(history, snapshots) {
  const normalize = s => ({ ...s, limitId: s.source === 'capisoft' && s.limitId === s.window ? 'codex' : s.limitId ?? 'codex', resetsAt: normalizeReset(s.resetsAt) });
  const key = s => `${s.limitId}:${s.window}:${s.capturedAt.slice(0, 16)}:${s.resetsAt ?? ''}:${s.source === 'manual' ? 'manual' : 'auto'}`;
  const items = new Map();
  for (const value of [...(history.snapshots ?? []), ...snapshots]) {
    const snapshot = normalize(value);
    const previous = items.get(key(snapshot));
    if (!previous || snapshot.capturedAt >= previous.capturedAt) items.set(key(snapshot), snapshot);
  }
  return { ...history, schemaVersion: 2, snapshots: [...items.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)) };
}
