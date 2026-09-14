import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const host = fileURLToPath(new URL('./host.mjs', import.meta.url));

test('新版校验失败回退、每天检查一次、完全失败保留缓存、协议分帧', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-usage-test-'));
  const env = { ...process.env, CODEX_USAGE_STATE_DIR: join(dir, 'state'), PATH: `${dir}:${process.env.PATH}`, TEST_DIR: dir };
  const raw = { daily: [{ period: '2026-09-09', agents: [{ agent: 'codex', inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 0, outputTokens: 5, totalTokens: 35, totalCost: .1, modelBreakdowns: [{ modelName: 'model', inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 0, outputTokens: 5, cost: .1 }] }] }] };
  try {
    await writeFile(join(dir, 'raw.json'), JSON.stringify(raw));
    await writeFile(join(dir, 'npm'), `#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(process.env.TEST_DIR+'/checks','x');console.log(JSON.stringify('2.0.0'));`, { mode: 0o700 });
    await writeFile(join(dir, 'npx'), `#!${process.execPath}\nconst fs=require('fs');fs.appendFileSync(process.env.TEST_DIR+'/npx-args',JSON.stringify(process.argv.slice(2))+'\\n');if(process.env.TEST_FAIL)process.exit(1);console.log(process.argv.includes('ccusage@2.0.0')?'{}':fs.readFileSync(process.env.TEST_DIR+'/raw.json','utf8'));`, { mode: 0o700 });
    const { mkdir } = await import('node:fs/promises'); await mkdir(env.CODEX_USAGE_STATE_DIR);
    await writeFile(join(env.CODEX_USAGE_STATE_DIR, 'state.json'), JSON.stringify({ active: '1.0.0' }));
    const run = async extra => {
      try { return JSON.parse((await exec(process.execPath, [host, '--sync'], { env: { ...env, ...extra } })).stdout); }
      catch (e) { return JSON.parse(e.stdout); }
    };
    const first = await run(); assert.equal(first.ok, true); assert.equal(first.report.version, '1.0.0'); assert.match(first.report.warnings[0], /回退/);
    await run(); assert.equal(await readFile(join(dir, 'checks'), 'utf8'), 'x');
    const calls = (await readFile(join(dir, 'npx-args'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(calls.some(args => args.includes('--since') && args.includes('--until')), '已有历史后只查询今天');
    const history = JSON.parse(await readFile(join(env.CODEX_USAGE_STATE_DIR, 'history.json'), 'utf8'));
    assert.equal(history.days.length, 1);
    const recordQuota = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [host], { env }); const chunks = [];
      child.stdout.on('data', chunk => chunks.push(chunk)); child.on('error', reject);
      child.on('close', code => code ? reject(new Error(`host ${code}`)) : resolve(Buffer.concat(chunks)));
      const body = Buffer.from(JSON.stringify({ type: 'recordQuota', remainingPercent: 95 })); const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
    });
    const quotaResponse = JSON.parse(recordQuota.subarray(4));
    assert.equal(quotaResponse.ok, true); assert.equal(quotaResponse.report.quota.weekly[0].remainingPercent, 95);
    const before = await readFile(join(env.CODEX_USAGE_STATE_DIR, 'report.json'), 'utf8');
    const failed = await run({ TEST_FAIL: '1' }); assert.equal(failed.ok, false); assert.equal(failed.report.stale, true);
    assert.equal(await readFile(join(env.CODEX_USAGE_STATE_DIR, 'report.json'), 'utf8'), before);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [host], { env }); const chunks = [];
      child.stdout.on('data', chunk => chunks.push(chunk)); child.on('error', reject);
      child.on('close', code => code ? reject(new Error(`host ${code}`)) : resolve(Buffer.concat(chunks)));
      const body = Buffer.from(JSON.stringify({ type: 'cache' })); const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
      child.stdin.write(header.subarray(0, 2)); child.stdin.write(header.subarray(2)); child.stdin.write(body);
    });
    assert.equal(result.readUInt32LE(0), result.length - 4);
    assert.equal(JSON.parse(result.subarray(4)).report.version, '1.0.0');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
