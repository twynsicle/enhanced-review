import { spawn } from 'node:child_process';
import { hostEnv } from '../../../config/host-env.ts';

/**
 * Spawns `git` non-interactively. Every prompt is disabled (no terminal
 * prompt, no askpass, batch-mode ssh) so a bad token fails fast instead of
 * hanging the job. Aborting the signal sends SIGTERM to the child.
 */
export interface GitRunOptions {
  args: readonly string[];
  cwd?: string;
  signal?: AbortSignal;
  /** Extra variables for this invocation only (auth headers, for example). */
  env?: Record<string, string | undefined>;
}

export interface GitRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GitRunner = (opts: GitRunOptions) => Promise<GitRunResult>;

export class GitCommandError extends Error {
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(message: string, stderr: string, exitCode: number | null) {
    super(message);
    this.name = 'GitCommandError';
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
};

export const runGit: GitRunner = (opts) =>
  new Promise<GitRunResult>((resolve, reject) => {
    const env = { ...hostEnv(), ...NON_INTERACTIVE_ENV, ...opts.env };
    const child = spawn('git', [...opts.args], {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const onAbort = () => {
      child.kill('SIGTERM');
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        child.kill('SIGTERM');
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    child.once('error', (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.once('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: code,
      });
    });
  });

/** Runs one git step and turns a non-zero exit into a `GitCommandError`. */
export async function runGitOrThrow(
  runner: GitRunner,
  step: string,
  opts: GitRunOptions,
): Promise<GitRunResult> {
  const result = await runner(opts);
  if (result.exitCode !== 0) {
    throw new GitCommandError(
      `git ${step} failed with exit ${String(result.exitCode)}`,
      result.stderr,
      result.exitCode,
    );
  }
  return result;
}
