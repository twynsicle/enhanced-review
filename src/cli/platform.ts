import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostEnv } from '../config/host-env.ts';

/**
 * Everything that differs by operating system lives here, so the macOS work
 * (docs/local-mode D13) has one file to change: where the tool itself is,
 * how it runs its own npm scripts, where temporary worktrees go, and how a
 * report is opened.
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

/** Opens a file with its default application: for a report, the default browser. */
export function openFile(file: string): void {
  // explorer.exe hands the file to its registered handler without a shell in between.
  spawn('explorer.exe', [file], { detached: true, stdio: 'ignore' }).unref();
}
