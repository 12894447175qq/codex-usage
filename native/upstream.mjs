import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { apiCostOfCalls, mergeApiPricing } from '../vendor/codex_usage/public/api-pricing.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bundledRoot = resolve(here, '../vendor/codex_usage');
const zone = 'Asia/Shanghai';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' });

const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const load = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function save(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
  await rename(tmp, path);
}

function usageOf(call) {
  const input = finite(call?.usage?.inputTokens);
  const cacheRead = finite(call?.usage?.cachedInputTokens);
  const cacheWrite = finite(call?.usage?.cacheWriteInputTokens);
  const output = finite(call?.usage?.outputTokens);
  return {
    inputTokens: Math.max(0, input - cacheRead - cacheWrite),
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheWrite,
    outputTokens: output,
    totalTokens: finite(call?.usage?.totalTokens) || input + output,
  };
}

function quotaSnapshots(quota, window, limitName) {
  if (!quota) return [];
  const points = Array.isArray(quota.observations) && quota.observations.length
    ? quota.observations
    : quota.observedAt && Number.isFinite(quota.usedPercent) ? [{ observedAt: quota.observedAt, usedPercent: quota.usedPercent }] : [];
  return points.flatMap(point => {
    const capturedAt = point.observedAt || quota.observedAt;
    if (!capturedAt || !Number.isFinite(Date.parse(capturedAt)) || !Number.isFinite(point.usedPercent)) return [];
    return [{
      date: dayFormat.format(new Date(capturedAt)),
      capturedAt: new Date(capturedAt).toISOString(),
      window,
      limitId: window,
      limitName,
      remainingPercent: Math.max(0, Math.min(100, 100 - Number(point.usedPercent))),
      resetsAt: quota.resetsAt || quota.endsAt || null,
      resetsAvailable: quota.resetsAvailable ?? null,
      planType: quota.planType || null,
      source: 'capisoft',
    }];
  });
}

function dedupeSnapshots(values) {
  const items = new Map();
  for (const item of values) {
    const key = `${item.window}:${item.capturedAt.slice(0, 16)}:${item.resetsAt || ''}`;
    items.set(key, item);
  }
  return [...items.values()].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

export function reportFromUsage(usage, { version = 'unknown', syncedAt = new Date().toISOString() } = {}) {
  if (!usage || usage.apiVersion !== 1 || !Array.isArray(usage.sessions)) throw new Error('capisoft 用量接口格式不兼容');
  const pricing = mergeApiPricing();
  const days = new Map();
  const today = dayFormat.format(new Date(syncedAt));
  const hours = new Map(Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, '0'), { hour, models: new Map() }]));

  for (const session of usage.sessions) {
    for (const call of Array.isArray(session.calls) ? session.calls : []) {
      const timestamp = new Date(call.timestamp);
      if (!Number.isFinite(timestamp.getTime())) continue;
      const date = dayFormat.format(timestamp);
      const model = String(call.model || 'unknown');
      const tokens = usageOf(call);
      const cost = apiCostOfCalls([call], pricing);
      const day = days.get(date) || { date, models: new Map() };
      const current = day.models.get(model) || { model, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, totalTokens: 0, costUSD: 0, costKnown: true, calls: 0 };
      for (const key of ['inputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'outputTokens', 'totalTokens']) current[key] += tokens[key];
      current.calls += 1;
      if (cost.unratedCalls) current.costKnown = false;
      else current.costUSD += cost.cost;
      day.models.set(model, current);
      days.set(date, day);

      if (date === today) {
        const hour = hourFormat.format(timestamp);
        const bucket = hours.get(hour);
        const value = bucket.models.get(model) || { model, totalTokens: 0, calls: 0 };
        value.totalTokens += tokens.totalTokens;
        value.calls += 1;
        bucket.models.set(model, value);
      }
    }
  }

  const normalizedDays = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
    date: day.date,
    models: [...day.models.values()].sort((a, b) => a.model.localeCompare(b.model)).map(model => ({
      ...model,
      costUSD: model.costKnown ? model.costUSD : null,
    })),
  }));
  const weekly = dedupeSnapshots([
    ...(usage.weeklyQuotaHistory || []).flatMap(quota => quotaSnapshots(quota, 'weekly', '每周额度')),
    ...quotaSnapshots(usage.weeklyQuota, 'weekly', '每周额度'),
  ]);
  const fiveHour = dedupeSnapshots(quotaSnapshots(usage.fiveHourQuota, 'five-hour', '5 小时额度'));

  return {
    schemaVersion: 3,
    version,
    syncedAt,
    timezone: zone,
    pricingSource: `capisoft codex_usage ${version} · 历史价格目录`,
    days: normalizedDays,
    heatmap: {
      date: today,
      hours: [...hours.values()].map(bucket => ({ hour: bucket.hour, models: [...bucket.models.values()] })),
    },
    quota: { weekly, fiveHour, error: null, checkedAt: usage.generatedAt || syncedAt },
    upstream: { apiVersion: usage.apiVersion, analyzerVersion: usage.analyzerVersion, errorCount: usage.errorCount || 0 },
  };
}

async function fileExists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

function upstreamRoot() {
  return resolve(process.env.CODEX_USAGE_UPSTREAM_DIR || bundledRoot);
}

async function prepareUpstream() {
  const root = upstreamRoot();
  if (!await fileExists(join(root, 'package.json'))) throw new Error('capisoft 子模块未初始化，请重新执行 node native/install.mjs');
  if (!await fileExists(join(root, 'dist/dashboard/index.html'))) {
    await exec(process.execPath, [join(root, 'scripts/build-dashboard-ui.mjs')], { cwd: root, timeout: 60_000 });
  }
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  return { root, version: String(pkg.version || 'unknown') };
}

async function capabilities(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/capabilities`, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) return null;
    const value = await response.json();
    return value?.apiVersion === 1 && Array.isArray(value.sources) ? value : null;
  } catch { return null; }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForDashboard(baseUrl, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`capisoft 本地面板启动失败（${child.exitCode}）`);
    if (await capabilities(baseUrl)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
  }
  throw new Error('capisoft 本地面板启动超时');
}

export async function ensureDashboard(stateDir) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const override = process.env.CODEX_USAGE_DASHBOARD_URL?.replace(/\/$/, '');
  if (override) {
    if (!await capabilities(override)) throw new Error('指定的 capisoft 面板不可用或接口版本不兼容');
    return { url: override, managed: false, version: 'external' };
  }

  const runtimePath = join(stateDir, 'capisoft-runtime.json');
  const previous = await load(runtimePath);
  if (previous?.url && await capabilities(previous.url)) return previous;
  const prepared = await prepareUpstream();
  let port = 4317;
  const defaultUrl = `http://127.0.0.1:${port}`;
  if (await capabilities(defaultUrl)) return { url: defaultUrl, managed: false, version: prepared.version };
  try {
    await new Promise((resolvePort, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolvePort));
    });
  } catch { port = await freePort(); }

  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: prepared.root,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DASHBOARD_MODE: 'local',
      SNAPSHOT_PATH: process.env.SNAPSHOT_PATH || join(stateDir, 'capisoft-usage-snapshot.json'),
      MESH_AGENT_STATE_PATH: process.env.MESH_AGENT_STATE_PATH || join(stateDir, 'capisoft-mesh-agent.json'),
    },
  });
  child.unref();
  await waitForDashboard(url, child);
  const runtime = { url, pid: child.pid, managed: true, version: prepared.version, startedAt: new Date().toISOString() };
  await save(runtimePath, runtime);
  return runtime;
}

export async function collectDashboardUsage(stateDir, force = false) {
  const dashboard = await ensureDashboard(stateDir);
  const response = await fetch(`${dashboard.url}/api/usage?source=local${force ? '&refresh=1' : ''}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`capisoft 用量读取失败（HTTP ${response.status}）`);
  return reportFromUsage(await response.json(), { version: dashboard.version, syncedAt: new Date().toISOString() });
}
