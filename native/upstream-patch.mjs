import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function applyUpstreamPatch(upstreamRoot, patchPath) {
  const options = { cwd: upstreamRoot, timeout: 15000 };
  try {
    await exec('git', ['apply', '--reverse', '--check', patchPath], options);
    return 'already-applied';
  } catch { /* 新安装尚未包含补丁；先检查后应用，冲突时保留本地修改。 */ }
  try {
    await exec('git', ['apply', '--check', patchPath], options);
  } catch (error) {
    throw new Error(`无法应用上游补丁，请核对子模块版本和本地修改；未改写文件。${error.stderr?.trim() || error.message}`, { cause: error });
  }
  await exec('git', ['apply', patchPath], options);
  return 'applied';
}
