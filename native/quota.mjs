import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// 只调用状态读取接口，不创建任务，也不读取或传输登录凭据。
export function readQuota({ bin = process.env.CODEX_USAGE_CODEX_BIN || (existsSync('/Applications/ChatGPT.app/Contents/Resources/codex') ? '/Applications/ChatGPT.app/Contents/Resources/codex' : 'codex'), timeout = 20000 } = {}) {
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
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'codex_usage_edge', version: '0.4.0' }, capabilities: null } });
  });
}

export function weeklySnapshots(raw, capturedAt = new Date().toISOString()) {
  const buckets = raw?.rateLimitsByLimitId ?? { codex: raw?.rateLimits };
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(capturedAt));
  return Object.entries(buckets).flatMap(([limitId, bucket]) => {
    const window = [bucket?.primary, bucket?.secondary].find(w => w?.windowDurationMins === 10080);
    if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) return [];
    return [{ date, capturedAt, window: 'weekly', limitId, limitName: bucket.limitName || limitId, remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)), resetsAt: window.resetsAt ?? null, source: 'codex' }];
  });
}

export function mergeQuota(history, snapshots) {
  const key = s => `${s.limitId ?? 'codex'}:${s.window}:${s.capturedAt.slice(0, 16)}:${s.resetsAt ?? ''}:${s.source}`;
  const items = new Map((history.snapshots ?? []).map(s => [key(s), s]));
  for (const snapshot of snapshots) items.set(key(snapshot), snapshot);
  return { ...history, schemaVersion: 2, snapshots: [...items.values()].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)) };
}
