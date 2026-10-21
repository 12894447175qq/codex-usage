import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyUpstreamPatch } from './upstream-patch.mjs';

const exec = promisify(execFile);
const patch = `diff --git a/rate.txt b/rate.txt
--- a/rate.txt
+++ b/rate.txt
@@ -1 +1 @@
-old
+new
diff --git a/added.txt b/added.txt
new file mode 100644
--- /dev/null
+++ b/added.txt
@@ -0,0 +1 @@
+fixture
`;
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-usage-patch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'upstream'); await mkdir(root);
  const path = join(dir, 'change.patch'); await writeFile(path, patch);
  return { dir, root, path };
}

test('价格补丁支持新安装和重复安装，包括新增文件', async t => {
  const { root, path } = await fixture(t);
  await writeFile(join(root, 'rate.txt'), 'old\n');
  assert.equal(await applyUpstreamPatch(root, path), 'applied');
  assert.equal(await readFile(join(root, 'rate.txt'), 'utf8'), 'new\n');
  assert.equal(await readFile(join(root, 'added.txt'), 'utf8'), 'fixture\n');
  assert.equal(await applyUpstreamPatch(root, path), 'already-applied');
});

test('价格补丁冲突时不覆盖用户文件，也不创建半套补丁文件', async t => {
  const { root, path } = await fixture(t);
  await writeFile(join(root, 'rate.txt'), 'user change\n');
  await assert.rejects(applyUpstreamPatch(root, path), /未改写文件/);
  assert.equal(await readFile(join(root, 'rate.txt'), 'utf8'), 'user change\n');
  await assert.rejects(access(join(root, 'added.txt')), { code: 'ENOENT' });
});

test('发布补丁可在干净子模块快照上恢复本地价格功能及其测试', async t => {
  const { dir, root } = await fixture(t);
  const upstream = fileURLToPath(new URL('../vendor/codex_usage/', import.meta.url));
  const releasePatch = fileURLToPath(new URL('../patches/codex-usage-pricing.patch', import.meta.url));
  const archive = join(dir, 'source.tar');
  await exec('git', ['archive', '--format=tar', `--output=${archive}`, 'f93c0920b1f1141b77967115aa08e994e3f52508', 'package.json', 'docs/pricing-history.md', 'public/api-pricing.js', 'public/pricing-catalog.js'], { cwd: upstream });
  await exec('tar', ['-xf', archive, '-C', root]);
  assert.equal(await applyUpstreamPatch(root, releasePatch), 'applied');
  assert.equal(await applyUpstreamPatch(root, releasePatch), 'already-applied');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = await exec(process.execPath, ['--test', '--test-reporter=tap', 'test/gpt6-pricing.test.mjs'], { cwd: root, env });
  assert.match(result.stdout, /# tests 4/);
  assert.match(result.stdout, /# fail 0/);
});
