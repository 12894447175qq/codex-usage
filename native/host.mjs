import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createQuotaSnapshot, mergeDays, migrateReport, upsertQuotaSnapshot } from './history.mjs';
import { mergeQuota } from './quota.mjs';
import { collectDashboardUsage, ensureDashboard } from './upstream.mjs';

const root = process.env.CODEX_USAGE_STATE_DIR || join(homedir(), '.codex-usage-edge');
const cachePath = join(root, 'report.json');
const historyPath = join(root, 'history.json');
const quotaPath = join(root, 'quota.json');
const lockPath = join(root, 'sync.lock');
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const load = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

async function save(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await rename(tmp, path);
}

async function loadHistory() {
  const stored = await load(historyPath);
  if (stored) {
    if (!Array.isArray(stored.days)) throw new Error('本地历史账本格式无效');
    return { schemaVersion: stored.schemaVersion || 1, timezone: 'Asia/Shanghai', updatedAt: stored.updatedAt ?? null, days: stored.days };
  }
  const migrated = migrateReport(await load(cachePath));
  if (migrated.days.length) await save(historyPath, migrated);
  return migrated;
}

async function loadQuota() {
  const stored = await load(quotaPath);
  if (!stored) return { schemaVersion: 2, snapshots: [] };
  if (!Array.isArray(stored.snapshots)) throw new Error('本地额度快照格式无效');
  return { ...stored, snapshots: stored.snapshots };
}

function quotaView(quota) {
  const snapshots = quota?.snapshots ?? [];
  return {
    weekly: snapshots.filter(snapshot => snapshot?.window === 'weekly'),
    fiveHour: snapshots.filter(snapshot => snapshot?.window === 'five-hour'),
    error: quota?.error ?? null,
    checkedAt: quota?.checkedAt ?? null,
  };
}

function cachedReport(history, quota, cached) {
  if (cached) return { ...cached, quota: quotaView(quota), historyDays: history.days.length };
  if (!history.days.length && !quota.snapshots.length) return null;
  const sourceVersion = history.days.at(-1)?.sourceVersion ?? null;
  return {
    schemaVersion: 3,
    version: sourceVersion,
    syncedAt: history.updatedAt ?? new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    pricingSource: '本地历史账本',
    days: history.days,
    heatmap: { date: day(), hours: [] },
    warnings: ['当前显示本地历史账本，尚未完成今日同步'],
    stale: true,
    quota: quotaView(quota),
    historyDays: history.days.length,
  };
}

async function sync(force) {
  const history = await loadHistory();
  const collected = await collectDashboardUsage(root, force);
  const mergedDays = mergeDays(history.days, collected.days, collected.version);
  if ((await load(cachePath))?.days?.length && !mergedDays.length) throw new Error('本次未发现 Codex 记录，为避免空结果覆盖历史统计，保留上次结果');

  const previousQuota = await loadQuota();
  const snapshots = [...(collected.quota?.weekly ?? []), ...(collected.quota?.fiveHour ?? [])];
  const mergedQuota = {
    ...mergeQuota(previousQuota, snapshots),
    error: collected.quota?.error ?? null,
    checkedAt: collected.quota?.checkedAt ?? collected.syncedAt,
  };
  const nextHistory = { schemaVersion: 2, timezone: 'Asia/Shanghai', updatedAt: collected.syncedAt, days: mergedDays };
  await save(historyPath, nextHistory);
  await save(quotaPath, mergedQuota);

  const warnings = [];
  if (collected.upstream?.errorCount) warnings.push(`有 ${collected.upstream.errorCount} 个 Codex 会话文件未能完整解析`);
  const response = {
    ...collected,
    days: mergedDays,
    warnings,
    stale: false,
    quota: quotaView(mergedQuota),
    historyDays: mergedDays.length,
  };
  if (Buffer.byteLength(JSON.stringify(response)) > 900000) throw new Error('统计结果超出本机通信大小限制，保留上次结果');
  await save(cachePath, response);
  return response;
}

async function recordQuota(request) {
  const quota = await loadQuota();
  const snapshot = createQuotaSnapshot({
    date: request.date ?? day(),
    capturedAt: request.capturedAt,
    window: request.window ?? 'weekly',
    remainingPercent: request.remainingPercent,
  });
  const nextQuota = upsertQuotaSnapshot(quota, snapshot);
  await save(quotaPath, nextQuota);
  const history = await loadHistory();
  const cached = await load(cachePath);
  const report = cachedReport(history, nextQuota, cached);
  if (report) await save(cachePath, report);
  return report;
}

async function withLock(fn) {
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    try { process.kill(pid, 0); throw new Error('另一个窗口正在同步，请稍后重试'); }
    catch (current) { if (current.code !== 'ESRCH') throw current; }
    await unlink(lockPath);
    lock = await open(lockPath, 'wx', 0o600);
  }
  try { await lock.writeFile(String(process.pid)); return await fn(); }
  finally { await lock.close(); await unlink(lockPath).catch(() => {}); }
}

async function handle(request) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (request.type === 'dashboard') {
    try {
      const dashboard = await ensureDashboard(root);
      return { ok: true, url: dashboard.url, version: dashboard.version };
    } catch (error) { return { ok: false, error: error.message }; }
  }
  if (request.type === 'cache') {
    const history = await loadHistory();
    return { ok: true, report: cachedReport(history, await loadQuota(), await load(cachePath)) };
  }
  if (request.type === 'recordQuota') {
    try { return { ok: true, report: await withLock(() => recordQuota(request)) }; }
    catch (error) {
      const history = await loadHistory();
      return { ok: false, error: error.message, report: cachedReport(history, await loadQuota(), await load(cachePath)) };
    }
  }
  if (request.type !== 'sync') throw new Error('不支持的请求');
  try { return { ok: true, report: await withLock(() => sync(request.force === true)) }; }
  catch (error) {
    const history = await loadHistory();
    const previous = cachedReport(history, await loadQuota(), await load(cachePath));
    return { ok: false, error: error.message, report: previous ? { ...previous, stale: true } : null };
  }
}

// Native Messaging 使用长度前缀；stdout 只能输出协议帧。
function send(value) {
  const body = Buffer.from(JSON.stringify(value));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([size, body]), () => process.exit(0));
}

if (process.argv.includes('--dashboard')) {
  console.log(JSON.stringify(await handle({ type: 'dashboard' })));
} else if (process.argv.includes('--sync')) {
  const result = await handle({ type: 'sync', force: process.argv.includes('--refresh') });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} else {
  let buffer = Buffer.alloc(0), started = false;
  process.stdin.on('data', chunk => {
    if (started) return;
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < 4) return;
    const length = buffer.readUInt32LE(0);
    if (length > 4096) return send({ ok: false, error: '请求过大' });
    if (buffer.length < 4 + length) return;
    started = true;
    Promise.resolve().then(() => JSON.parse(buffer.subarray(4, length + 4)))
      .then(handle).then(send).catch(error => send({ ok: false, error: error.message }));
  });
}
