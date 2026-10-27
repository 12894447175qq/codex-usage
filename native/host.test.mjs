import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const host = fileURLToPath(new URL('./host.mjs', import.meta.url));

function message(env, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [host], { env });
    const chunks = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(`host ${code}`)) : resolve(Buffer.concat(chunks)));
    const payload = Buffer.from(JSON.stringify(body));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length);
    child.stdin.write(header.subarray(0, 2));
    child.stdin.write(header.subarray(2));
    child.stdin.write(payload);
  });
}

test('使用 capisoft API 同步、保留缓存并支持打开完整面板', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-usage-test-'));
  const usage = {
    apiVersion: 1,
    analyzerVersion: 10,
    generatedAt: '2026-09-14T01:05:00.000Z',
    sessions: [{ calls: [{ timestamp: '2026-09-14T01:00:00.000Z', model: 'gpt-5.3-codex', serviceTier: 'standard', usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, totalTokens: 15 } }] }],
    fiveHourQuota: { usedPercent: 12, observedAt: '2026-09-14T01:05:00.000Z', resetsAt: '2026-09-14T06:00:00.000Z' },
    weeklyQuota: { usedPercent: 7, observedAt: '2026-09-14T01:05:00.000Z', resetsAt: '2026-09-21T01:05:00.000Z' },
    weeklyQuotaHistory: [],
  };
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/capabilities') response.end(JSON.stringify({ apiVersion: 1, runtime: 'local', sources: ['local'], defaultSource: 'local' }));
    else if (request.url.startsWith('/api/usage')) response.end(JSON.stringify(usage));
    else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const fakeCodex = join(dir, 'fake-codex.mjs');
  const live = { rateLimitsByLimitId: { codex: { planType: 'prolite', primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1792309526 } } }, rateLimitResetCredits: { availableCount: 3 } };
  await writeFile(fakeCodex, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') console.log(JSON.stringify({ id: 1, result: {} }));
  if (request.method === 'account/rateLimits/read') console.log(JSON.stringify({ id: 2, result: ${JSON.stringify(live)} }));
});
`);
  await chmod(fakeCodex, 0o700);
  const originalSessions = usage.sessions;
  const env = { ...process.env, CODEX_USAGE_CODEX_BIN: fakeCodex, CODEX_USAGE_STATE_DIR: join(dir, 'state'), CODEX_USAGE_DASHBOARD_URL: url };
  try {
    const first = JSON.parse((await exec(process.execPath, [host, '--sync'], { env })).stdout);
    assert.equal(first.ok, true);
    assert.equal(first.report.schemaVersion, 6);
    assert.equal('costUSD' in first.report.days[0].models[0], false);
    assert.equal(first.report.quota.current.length, 1);
    assert.equal(first.report.quota.current[0].remainingPercent, 90);
    assert.equal(first.report.quota.current[0].resetsAvailable, 3);
    assert.equal(first.report.quota.current[0].limitId, 'codex');
    assert.equal(first.report.quota.error, null);
    assert.equal(first.report.days[0].models[0].totalTokens, 15);
    assert.equal(first.report.quota.weekly[0].remainingPercent, 93);
    assert.equal(first.report.quota.fiveHour[0].remainingPercent, 88);
    assert.equal(JSON.parse(await readFile(join(env.CODEX_USAGE_STATE_DIR, 'history.json'), 'utf8')).days.length, 1);

    // A running managed daemon must not silently keep using the pre-fix parser.
    await writeFile(join(env.CODEX_USAGE_STATE_DIR, 'capisoft-runtime.json'), JSON.stringify({ url, managed: true, version: 'fixture' }));
    const managedEnv = { ...env }; delete managedEnv.CODEX_USAGE_DASHBOARD_URL;
    const staleAnalyzer = JSON.parse((await message(managedEnv, { type: 'sync' })).subarray(4));
    assert.equal(staleAnalyzer.ok, false);
    assert.match(staleAnalyzer.error, /旧解析器/);
    assert.equal(staleAnalyzer.report.days[0].models[0].totalTokens, 15);
    usage.analyzerVersion = 11;
    const freshAnalyzer = JSON.parse((await message(managedEnv, { type: 'sync' })).subarray(4));
    assert.equal(freshAnalyzer.ok, true);
    assert.equal(freshAnalyzer.report.days[0].models[0].totalTokens, 15);

    const dashboardFrame = await message(env, { type: 'dashboard' });
    assert.equal(dashboardFrame.readUInt32LE(0), dashboardFrame.length - 4);
    assert.equal(JSON.parse(dashboardFrame.subarray(4)).url, url);

    const oldCache = { ...first.report, schemaVersion: 5, pricingSource: 'legacy', pricingCatalogVersion: 'legacy', days: [{ ...first.report.days[0], models: [{ ...first.report.days[0].models[0], costUSD: .1, knownCostUSD: .1 }] }] };
    await writeFile(join(env.CODEX_USAGE_STATE_DIR, 'report.json'), JSON.stringify(oldCache));
    const cacheFrame = await message(env, { type: 'cache' });
    assert.equal(cacheFrame.readUInt32LE(0), cacheFrame.length - 4);
    assert.equal(JSON.parse(cacheFrame.subarray(4)).report.version, 'external');
    const migratedCache = JSON.parse(cacheFrame.subarray(4)).report;
    assert.equal(migratedCache.schemaVersion, 6);
    assert.equal('pricingSource' in migratedCache, false);
    assert.equal('costUSD' in migratedCache.days[0].models[0], false);

    // 超限结果不能先写入账本，否则下一次读取会把失败结果当成历史。
    const historyBefore = await readFile(join(env.CODEX_USAGE_STATE_DIR, 'history.json'), 'utf8');
    const quotaBefore = await readFile(join(env.CODEX_USAGE_STATE_DIR, 'quota.json'), 'utf8');
    // Token-only rows are smaller; keep the fixture above the unchanged 900KB limit.
    usage.sessions = [{ calls: Array.from({ length: 10000 }, (_, index) => ({
      timestamp: '2026-09-15T01:00:00.000Z', model: `future-model-${index}`,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })) }];
    const oversized = JSON.parse((await message(env, { type: 'sync' })).subarray(4));
    assert.equal(oversized.ok, false);
    assert.match(oversized.error, /大小限制/);
    assert.equal(await readFile(join(env.CODEX_USAGE_STATE_DIR, 'history.json'), 'utf8'), historyBefore);
    assert.equal(await readFile(join(env.CODEX_USAGE_STATE_DIR, 'quota.json'), 'utf8'), quotaBefore);

    usage.sessions = originalSessions;
    const quotaFailure = JSON.parse((await exec(process.execPath, [host, '--sync'], { env: { ...env, CODEX_USAGE_CODEX_BIN: '/nonexistent/codex' } })).stdout);
    assert.equal(quotaFailure.ok, true);
    assert.deepEqual(quotaFailure.report.quota.current, []);
    assert.match(quotaFailure.report.quota.error, /无法启动/);
    assert.equal(quotaFailure.report.quota.weekly.length, first.report.quota.weekly.length);
    assert.ok(quotaFailure.report.warnings.some(warning => warning.includes('实时额度读取失败')));

    await new Promise(resolve => server.close(resolve));
    let failed;
    try { failed = JSON.parse((await exec(process.execPath, [host, '--sync'], { env })).stdout); }
    catch (error) { failed = JSON.parse(error.stdout); }
    assert.equal(failed.ok, false);
    assert.equal(failed.report.stale, true);
    assert.equal(failed.report.days[0].models[0].totalTokens, 15);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
