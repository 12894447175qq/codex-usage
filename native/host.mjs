import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalize } from './normalize.mjs';
import { createQuotaSnapshot, mergeDays, migrateReport, upsertQuotaSnapshot } from './history.mjs';

const exec = promisify(execFile);
const root = process.env.CODEX_USAGE_STATE_DIR || join(homedir(), '.codex-usage-edge');
const cachePath = join(root, 'report.json');
const historyPath = join(root, 'history.json');
const quotaPath = join(root, 'quota.json');
const statePath = join(root, 'state.json');
const lockPath = join(root, 'sync.lock');
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const load = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
async function save(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await rename(tmp, path);
}
function version(v) {
  if (typeof v !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v)) throw new Error('npm 返回了无效版本');
  return v;
}
async function command(bin, args, timeout = 180000) {
  try {
    return await exec(bin, args, { cwd: root, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  } catch (e) {
    // 不将子进程可能输出的本地路径或原始内容传给浏览器。
    throw new Error(`${bin} 执行失败（${e.killed ? '超时' : e.code ?? '未知错误'}）`);
  }
}
async function collect(v, range = {}) {
  const config = join(root, 'ccusage.json');
  // 独立配置避免用户的其他 ccusage 日期筛选或隐藏费用设置影响报告。
  await save(config, {});
  const args = ['--yes', `ccusage@${version(v)}`, 'daily', '--by-agent', '--json', '--timezone', 'Asia/Shanghai', '--no-offline', '--config', config];
  if (range.since) args.push('--since', range.since);
  if (range.until) args.push('--until', range.until);
  const { stdout } = await command('npx', args);
  return { schemaVersion: 1, version: v, syncedAt: new Date().toISOString(), timezone: 'Asia/Shanghai', pricingSource: 'ccusage / LiteLLM（API 等价估算）', days: normalize(JSON.parse(stdout)) };
}
async function loadHistory() {
  const stored = await load(historyPath);
  if (stored) {
    if (!Array.isArray(stored.days)) throw new Error('本地历史账本格式无效');
    return { schemaVersion: 1, timezone: 'Asia/Shanghai', updatedAt: stored.updatedAt ?? null, days: stored.days };
  }
  // 升级旧版本：把已有报告迁移到独立账本，之后只更新今天的数据。
  const migrated = migrateReport(await load(cachePath));
  if (migrated.days.length) await save(historyPath, migrated);
  return migrated;
}
async function loadQuota() {
  const stored = await load(quotaPath);
  if (!stored) return { schemaVersion: 1, snapshots: [] };
  if (!Array.isArray(stored.snapshots)) throw new Error('本地额度快照格式无效');
  return { schemaVersion: 1, snapshots: stored.snapshots };
}
function quotaView(quota) {
  return { weekly: (quota?.snapshots ?? []).filter(snapshot => snapshot?.window === 'weekly') };
}
function cachedReport(history, quota, cached) {
  if (cached) return { ...cached, quota: quotaView(quota), historyDays: history.days.length };
  if (!history.days.length && !quota.snapshots.length) return null;
  const sourceVersion = history.days.at(-1)?.sourceVersion ?? null;
  return {
    schemaVersion: 2,
    version: sourceVersion,
    syncedAt: history.updatedAt ?? new Date().toISOString(),
    timezone: 'Asia/Shanghai',
    pricingSource: 'ccusage / LiteLLM（API 等价估算）',
    days: history.days,
    warnings: ['当前显示本地历史账本，尚未完成今日同步'],
    stale: true,
    latestVersion: sourceVersion,
    quota: quotaView(quota),
    historyDays: history.days.length,
  };
}
async function sync(force) {
  const state = await load(statePath) ?? {};
  const history = await loadHistory();
  const range = history.days.length ? { since: day(), until: day() } : {};
  let candidate = state.active;
  const warnings = [];
  if (force || state.checkedDay !== day()) {
    state.checkedDay = day();
    try {
      const { stdout } = await command('npm', ['view', 'ccusage', 'version', '--json'], 25000);
      candidate = version(JSON.parse(stdout));
      state.latest = candidate;
      delete state.updateError;
    } catch (e) { state.updateError = `检查更新失败：${e.message}`; }
    await save(statePath, state);
  } else candidate = state.latest ?? state.active;
  if (state.updateError) warnings.push(state.updateError);
  if (!candidate) throw new Error('首次同步需要联网获取 ccusage，请检查网络后重试检查更新');
  let report;
  try { report = await collect(candidate, range); }
  catch (e) {
    if (!state.active || candidate === state.active) throw e;
    warnings.push(`新版 ${candidate} 未通过运行或数据校验，已回退 ${state.active}：${e.message}`);
    report = await collect(state.active, range);
  }
  const previous = await load(cachePath);
  const mergedDays = mergeDays(history.days, report.days, report.version);
  if (previous?.days?.length && !mergedDays.length) throw new Error('本次未发现 Codex 记录，为避免空结果覆盖历史统计，保留上次结果');
  const nextHistory = { schemaVersion: 1, timezone: 'Asia/Shanghai', updatedAt: report.syncedAt, days: mergedDays };
  await save(historyPath, nextHistory);
  const quota = await loadQuota();
  const response = { ...report, days: mergedDays, warnings, stale: false, latestVersion: state.latest ?? report.version, quota: quotaView(quota), historyDays: mergedDays.length };
  if (Buffer.byteLength(JSON.stringify(response)) > 900000) throw new Error('统计结果超出本机通信大小限制，保留上次结果');
  await save(cachePath, response);
  state.active = report.version;
  await save(statePath, state);
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
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(await readFile(lockPath, 'utf8'));
    try { process.kill(pid, 0); throw new Error('另一个窗口正在同步，请稍后重试'); }
    catch (err) { if (err.code !== 'ESRCH') throw err; }
    await unlink(lockPath);
    lock = await open(lockPath, 'wx', 0o600);
  }
  try { await lock.writeFile(String(process.pid)); return await fn(); }
  finally { await lock.close(); await unlink(lockPath).catch(() => {}); }
}
async function handle(request) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (request.type === 'cache') {
    const history = await loadHistory();
    return { ok: true, report: cachedReport(history, await loadQuota(), await load(cachePath)) };
  }
  if (request.type === 'recordQuota') {
    try { return { ok: true, report: await withLock(() => recordQuota(request)) }; }
    catch (e) {
      const history = await loadHistory();
      return { ok: false, error: e.message, report: cachedReport(history, await loadQuota(), await load(cachePath)) };
    }
  }
  if (request.type !== 'sync') throw new Error('不支持的请求');
  try { return { ok: true, report: await withLock(() => sync(request.force === true)) }; }
  catch (e) {
    const history = await loadHistory();
    const previous = cachedReport(history, await loadQuota(), await load(cachePath));
    return { ok: false, error: e.message, report: previous ? { ...previous, stale: true } : null };
  }
}

// Native Messaging 使用长度前缀；stdout 只能输出协议帧。
function send(value) {
  const body = Buffer.from(JSON.stringify(value));
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([size, body]), () => process.exit(0));
}
if (process.argv.includes('--sync')) {
  const result = await handle({ type: 'sync', force: process.argv.includes('--check-update') });
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
      .then(handle).then(send).catch(e => send({ ok: false, error: e.message }));
  });
}
