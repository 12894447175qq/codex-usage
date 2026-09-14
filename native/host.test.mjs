import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  const env = { ...process.env, CODEX_USAGE_STATE_DIR: join(dir, 'state'), CODEX_USAGE_DASHBOARD_URL: url };
  try {
    const first = JSON.parse((await exec(process.execPath, [host, '--sync'], { env })).stdout);
    assert.equal(first.ok, true);
    assert.equal(first.report.days[0].models[0].totalTokens, 15);
    assert.equal(first.report.quota.weekly[0].remainingPercent, 93);
    assert.equal(first.report.quota.fiveHour[0].remainingPercent, 88);
    assert.equal(JSON.parse(await readFile(join(env.CODEX_USAGE_STATE_DIR, 'history.json'), 'utf8')).days.length, 1);

    const dashboardFrame = await message(env, { type: 'dashboard' });
    assert.equal(dashboardFrame.readUInt32LE(0), dashboardFrame.length - 4);
    assert.equal(JSON.parse(dashboardFrame.subarray(4)).url, url);

    const cacheFrame = await message(env, { type: 'cache' });
    assert.equal(cacheFrame.readUInt32LE(0), cacheFrame.length - 4);
    assert.equal(JSON.parse(cacheFrame.subarray(4)).report.version, 'external');

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
