import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

if (process.platform !== 'darwin') throw new Error('当前安装脚本适用于 macOS Edge；其他系统需要单独注册 Native Messaging 主机');
const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const upstreamRoot = join(projectRoot, 'vendor/codex_usage');
const exec = promisify(execFile);
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };

// 子模块保留 capisoft 的完整功能和许可证，安装时生成其本地 Web 资源。
if (!await exists(join(upstreamRoot, 'package.json'))) {
  await exec('git', ['submodule', 'update', '--init', '--depth', '1', 'vendor/codex_usage'], { cwd: projectRoot, timeout: 120_000 });
}
await exec(process.execPath, [join(upstreamRoot, 'scripts/build-dashboard-ui.mjs')], { cwd: upstreamRoot, timeout: 60_000 });
const manifest = JSON.parse(await readFile(resolve(here, '../extension/manifest.json'), 'utf8'));
const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
const stateDir = join(homedir(), '.codex-usage-edge');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const launcher = join(stateDir, 'host.sh');
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
// Edge 启动进程的 PATH 通常不含 Node，安装时保存当前可用环境。
await writeFile(launcher, `#!/bin/sh\nexport PATH=${quote(process.env.PATH ?? '')}\nexec ${quote(process.execPath)} ${quote(join(here, 'host.mjs'))}\n`, { mode: 0o700 });
await chmod(launcher, 0o700);
const registrationDir = join(homedir(), 'Library/Application Support/Microsoft Edge/NativeMessagingHosts');
await mkdir(registrationDir, { recursive: true });
const registration = join(registrationDir, 'com.codex.usage.json');
await writeFile(registration, JSON.stringify({ name: 'com.codex.usage', description: 'Codex 本机用量统计', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }, null, 2));
console.log(`本地主机已注册：${registration}\n在 Edge 扩展管理页打开开发者模式，加载已解压缩的扩展：${resolve(here, '../extension')}\n扩展 ID：${id}`);
