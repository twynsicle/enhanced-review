import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from '@/lib/log';
import { GitCommandError, runGit, runGitOrThrow, type GitRunner } from './git-runner';

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
  gitRunner?: GitRunner;
  makeWorkDir?: (jobId: string) => Promise<string>;
}

async function defaultMakeWorkDir(jobId: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `review-${jobId}-`));
}

function buildCloneUrl(token: string, owner: string, repo: string): string {
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

  const headRef = input.target.kind === 'pr' ? input.target.headRef : input.target.ref;

  // `git clone --branch` only accepts refs/heads/* and refs/tags/*, so it can't
  // resolve GitHub's refs/pull/N/head. Initialize an empty repo and fetch the
  // ref directly — works for branches and pull-request heads alike.
  await runGitOrThrow(runner, 'init', {
    args: ['init', '--quiet'],
    cwd: cloneDir,
    signal: input.signal,
  });
  await runGitOrThrow(runner, 'remote add origin', {
    args: ['remote', 'add', 'origin', url],
    cwd: cloneDir,
    signal: input.signal,
  });
  await runGitOrThrow(runner, 'fetch head', {
    args: ['fetch', '--depth=1', 'origin', headRef],
    cwd: cloneDir,
    signal: input.signal,
  });
  await runGitOrThrow(runner, 'checkout head', {
    args: ['checkout', '--quiet', 'FETCH_HEAD'],
    cwd: cloneDir,
    signal: input.signal,
  });

  const headRev = await runGitOrThrow(runner, 'rev-parse HEAD', {
    args: ['rev-parse', 'HEAD'],
    cwd: cloneDir,
    signal: input.signal,
  });
  const actualHead = headRev.stdout.trim();
  if (actualHead !== input.expectedHeadSha) {
    throw new HeadShaMismatchError(input.expectedHeadSha, actualHead);
  }

  await runGitOrThrow(runner, 'fetch base', {
    args: ['fetch', '--depth=1', 'origin', input.target.baseSha],
    cwd: cloneDir,
    signal: input.signal,
  });

  const diff = await runGitOrThrow(runner, 'diff', {
    args: ['diff', `${input.target.baseSha}..${actualHead}`],
    cwd: cloneDir,
    signal: input.signal,
  });

  return { cloneDir, diff: diff.stdout };
}

export async function cleanupWorkDir(cloneDir: string): Promise<void> {
  try {
    await rm(cloneDir, { recursive: true, force: true });
  } catch (err) {
    logger.error({ clone_dir: cloneDir, err }, 'cleanupWorkDir failed');
  }
}

export { GitCommandError };
