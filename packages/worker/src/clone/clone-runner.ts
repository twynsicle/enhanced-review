import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from '../log';
import { GitCommandError, runGit, runGitOrThrow, type GitRunner } from './git-runner';

/**
 * Clone the user's repo at the recorded head SHA, fetch the diff base
 * separately (depth=1 each), verify the head commit matches, and return
 * the unified diff. The caller wraps the whole thing in a try/finally
 * that calls `cleanupWorkDir`.
 *
 * The token-bearing URL never appears in the returned values or in any
 * log line. `runGitOrThrow` reports errors using the step name only.
 */

export interface CloneTargetPr {
  kind: 'pr';
  owner: string;
  repo: string;
  headRef: string;
  baseSha: string;
}

export interface CloneTargetBranch {
  kind: 'branch';
  owner: string;
  repo: string;
  ref: string;
  baseRef: string;
  baseSha: string;
}

export type CloneTarget = CloneTargetPr | CloneTargetBranch;

export interface CloneInput {
  jobId: string;
  token: string;
  target: CloneTarget;
  expectedHeadSha: string;
  signal?: AbortSignal;
}

export interface CloneOutput {
  cloneDir: string;
  diff: string;
}

export class HeadShaMismatchError extends Error {
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(
      `head SHA changed since job submit (expected ${expected.slice(0, 7)}, got ${actual.slice(0, 7)})`,
    );
    this.name = 'HeadShaMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

export interface CloneRunnerDeps {
  /** Test seam: substitute a fake runner. Defaults to spawning real git. */
  gitRunner?: GitRunner;
  /** Test seam: deterministic tmpdir factory. Defaults to mkdtemp(os.tmpdir()). */
  makeWorkDir?: (jobId: string) => Promise<string>;
}

async function defaultMakeWorkDir(jobId: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `review-${jobId}-`));
}

function buildCloneUrl(token: string, owner: string, repo: string): string {
  // x-access-token is GitHub's documented username for OAuth-token-based
  // HTTPS auth. Encode the token in case it contains URL-special chars
  // (current PATs don't, but it's cheap insurance).
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
}

export async function cloneAndDiff(
  input: CloneInput,
  deps: CloneRunnerDeps = {},
): Promise<CloneOutput> {
  const runner = deps.gitRunner ?? runGit;
  const makeDir = deps.makeWorkDir ?? defaultMakeWorkDir;

  const cloneDir = await makeDir(input.jobId);
  const url = buildCloneUrl(input.token, input.target.owner, input.target.repo);

  // Step 1: shallow clone of the head ref.
  const headRef = input.target.kind === 'pr' ? input.target.headRef : input.target.ref;
  await runGitOrThrow(runner, 'clone', {
    args: ['clone', '--depth=1', '--branch', headRef, url, cloneDir],
    signal: input.signal,
  });

  // Step 2: verify the cloned head matches the expected SHA. If the
  // upstream has moved since job submit, the diff base would be wrong.
  const headRev = await runGitOrThrow(runner, 'rev-parse HEAD', {
    args: ['rev-parse', 'HEAD'],
    cwd: cloneDir,
    signal: input.signal,
  });
  const actualHead = headRev.stdout.trim();
  if (actualHead !== input.expectedHeadSha) {
    throw new HeadShaMismatchError(input.expectedHeadSha, actualHead);
  }

  // Step 3: fetch the base SHA so `git diff base..head` works.
  await runGitOrThrow(runner, 'fetch base', {
    args: ['fetch', '--depth=1', 'origin', input.target.baseSha],
    cwd: cloneDir,
    signal: input.signal,
  });

  // Step 4: compute the diff. We deliberately don't pass `--no-color` etc;
  // git outputs plain text to a non-tty by default.
  const diff = await runGitOrThrow(runner, 'diff', {
    args: ['diff', `${input.target.baseSha}..${actualHead}`],
    cwd: cloneDir,
    signal: input.signal,
  });

  return { cloneDir, diff: diff.stdout };
}

/**
 * Recursively remove the per-job working directory. Swallows errors —
 * the OS will GC tmpdirs eventually if a single rm fails.
 */
export async function cleanupWorkDir(cloneDir: string): Promise<void> {
  try {
    await rm(cloneDir, { recursive: true, force: true });
  } catch (err) {
    logger.error({ clone_dir: cloneDir, err }, 'cleanupWorkDir failed');
  }
}

export { GitCommandError };
