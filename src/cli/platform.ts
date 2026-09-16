import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostEnv } from '../config/host-env.ts';

/**
 * Everything that differs by operating system lives here: where the tool
 * itself is, how it runs its own npm scripts, where temporary worktrees go,
 * and how a report is opened. Supports Windows and macOS.
 */

/** The root of this tool's own clone, found from this file's real location. */
export const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function toolVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(TOOL_ROOT, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}

export interface ScriptResult {
  exitCode: number | null;
  output: string;
}

/**
 * `npm run <script>` in `cwd`, output captured. On Windows npm is a `.cmd`
 * shim, which only a shell can start; the command is a fixed string, never
 * built from input.
 */
export function runNpmScript(script: 'viewer:build', cwd: string): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(`npm run ${script}`, {
      cwd,
      env: hostEnv(),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const output: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({ exitCode, output: Buffer.concat(output).toString('utf8') });
    });
  });
}

/**
 * Where PR worktrees go: the OS temp dir, resolved past any symlink (macOS's
 * `/tmp` is one) so it matches the paths `git worktree list` reports back.
 */
export function worktreeParent(): string {
  return realpathSync(os.tmpdir());
}

/** A hooks path that holds no hooks, so git runs none. */
export const NO_HOOKS_PATH = os.devNull;

/** Whether `child` is `parent` or inside it; Windows paths compare case-insensitively. */
export function isInside(parent: string, child: string): boolean {
  const caseInsensitive = process.platform === 'win32';
  const [parentCmp, childCmp] = caseInsensitive
    ? [parent.toLowerCase(), child.toLowerCase()]
    : [parent, child];
  const relative = path.relative(parentCmp, childCmp);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Opens a file with its default application: for a report, the default browser. */
export function openFile(file: string): void {
  // Both hand the file to its registered handler without a shell in between.
  const command = process.platform === 'win32' ? 'explorer.exe' : 'open';
  spawn(command, [file], { detached: true, stdio: 'ignore' }).unref();
}
