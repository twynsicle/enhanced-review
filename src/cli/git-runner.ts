import { spawn } from 'node:child_process';
import { hostEnv } from './host-env.ts';

/**
 * Spawns `git` non-interactively, and by default with the host's own git
 * configuration out of the way, which is what the tests run under. Every
 * prompt is disabled (no terminal prompt, no askpass, batch-mode ssh) so a bad
 * credential fails fast instead of hanging the run. Aborting the signal sends
 * SIGTERM to the child.
 */
export interface GitRunOptions {
  args: readonly string[];
  cwd?: string;
  signal?: AbortSignal;
  /** Extra variables for this invocation only (auth headers, for example). */
  env?: Record<string, string | undefined>;
  /**
   * Read the host's system and global git configuration, which is otherwise
   * ignored. For a command that has to act as the person running it — their
   * credential helper, proxy and `url.insteadOf` reach a remote, their
   * `safe.directory` entries decide whether git will touch a repository at
   * all — those files are what makes git work.
   */
  hostConfig?: boolean;
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

/**
 * The system and global configuration files, ignored. Either can carry a
 * setting that rewrites a diff — `diff.noprefix`, `core.quotePath`, colour, an
 * external or textconv driver — and the hunk catalog reads
 * `diff --git a/<path> b/<path>` and nothing else, so a single such setting on
 * the host collapses the catalog to empty.
 *
 * `/dev/null` is git's own spelling for an empty configuration and is
 * understood on Windows too; a path that merely does not exist is a fatal
 * error rather than an empty file.
 */
const NO_AMBIENT_CONFIG: Record<string, string> = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

export const runGit: GitRunner = (opts) =>
  new Promise<GitRunResult>((resolve, reject) => {
    const env = {
      ...hostEnv(),
      ...NON_INTERACTIVE_ENV,
      ...(opts.hostConfig ? {} : NO_AMBIENT_CONFIG),
      ...opts.env,
    };
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

/** Paths per command line, well inside Windows' 32K limit. */
const MAX_ARG_CHARS = 16_000;

/**
 * Splits a path list into batches a single `git` invocation can carry. A
 * repository can change more files than any platform allows arguments for, and
 * the command that ran into that limit fails as a whole: a command per path
 * instead would cost a process spawn each, which on Windows is the slowest
 * thing these paths do.
 */
export function argBatches(paths: readonly string[]): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const name of paths) {
    if (current.length > 0 && length + name.length + 1 > MAX_ARG_CHARS) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(name);
    length += name.length + 1;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** How many git processes a stage keeps running at once. */
export const PARALLEL_GIT = 8;

/** `fn` over every item, at most `limit` at a time, results in item order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  };
  // At least one worker: a limit under 1 would start none and hand back an
  // array of undefined without ever calling `fn`.
  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
