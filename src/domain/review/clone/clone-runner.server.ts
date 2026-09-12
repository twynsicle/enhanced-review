import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { logger } from '../../../common/logger.ts';
import type { ReviewTarget } from '../target.ts';
import { GitCommandError, runGit, runGitOrThrow, type GitRunner } from './git-runner.server.ts';

/**
 * Materialises the review target on disk and produces the unified diff:
 * init → fetch the head ref (shallow) → verify the SHA still matches what the
 * job was submitted with → fetch the base SHA (shallow) → `git diff`.
 *
 * `git clone --branch` cannot resolve GitHub's `refs/pull/N/head`, so the
 * runner initialises an empty repository and fetches the ref directly; that
 * works for branches and pull-request heads alike.
 */
export interface CloneInput {
  jobId: string;
  /** GitHub token; sent as a basic-auth extraheader scoped to github.com. */
  token: string;
  /** Where to fetch from (injected so tests can use `file://`). */
  cloneUrl: string;
  /** The ref to fetch for the head: `pull/N/head` or a branch name. */
  headRef: string;
  baseSha: string;
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
  git?: GitRunner;
  makeWorkDir?: (jobId: string) => Promise<string>;
}

function defaultMakeWorkDir(jobId: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `review-${jobId}-`));
}

/** The production clone URL for a target. */
export function githubCloneUrl(target: Pick<ReviewTarget, 'owner' | 'repo'>): string {
  return `https://github.com/${target.owner}/${target.repo}.git`;
}

/** The ref the runner fetches for a target's head. */
export function headRefFor(target: ReviewTarget): string {
  return target.kind === 'pr' ? `pull/${String(target.number)}/head` : target.ref;
}

function gitAuthEnv(token: string): Record<string, string> {
  const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
  };
}

export async function cloneAndDiff(
  input: CloneInput,
  deps: CloneRunnerDeps = {},
): Promise<CloneOutput> {
  const git = deps.git ?? runGit;
  const makeWorkDir = deps.makeWorkDir ?? defaultMakeWorkDir;

  const cloneDir = await makeWorkDir(input.jobId);
  const authEnv = gitAuthEnv(input.token);
  const common = { cwd: cloneDir, signal: input.signal };

  await runGitOrThrow(git, 'init', { ...common, args: ['init', '--quiet'] });
  await runGitOrThrow(git, 'remote add origin', {
    ...common,
    args: ['remote', 'add', 'origin', input.cloneUrl],
  });
  await runGitOrThrow(git, 'fetch head', {
    ...common,
    args: ['fetch', '--depth=1', 'origin', input.headRef],
    env: authEnv,
  });
  await runGitOrThrow(git, 'checkout head', {
    ...common,
    args: ['checkout', '--quiet', 'FETCH_HEAD'],
  });

  const headRev = await runGitOrThrow(git, 'rev-parse HEAD', {
    ...common,
    args: ['rev-parse', 'HEAD'],
  });
  const actualHead = headRev.stdout.trim();
  if (actualHead !== input.expectedHeadSha) {
    throw new HeadShaMismatchError(input.expectedHeadSha, actualHead);
  }

  await runGitOrThrow(git, 'fetch base', {
    ...common,
    args: ['fetch', '--depth=1', 'origin', input.baseSha],
    env: authEnv,
  });

  const diff = await runGitOrThrow(git, 'diff', {
    ...common,
    /*
     * The hunk catalog reads `diff --git a/<path> b/<path>` and nothing else,
     * so every setting that can rewrite that line is pinned here rather than
     * left to the host's gitconfig, which this process inherits. Without the
     * pins a non-ASCII path arrives quoted whole (`"a/src/caf\303\251.ts"`),
     * `diff.noprefix` and `diff.mnemonicPrefix` replace the `a/` and `b/`, and
     * colour or an external/textconv driver rewrites the body — each of which
     * matches nothing and collapses the whole catalog to empty.
     */
    args: [
      '-c',
      'core.quotePath=false',
      '-c',
      'diff.noprefix=false',
      '-c',
      'diff.mnemonicPrefix=false',
      '-c',
      'diff.srcPrefix=a/',
      '-c',
      'diff.dstPrefix=b/',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      `${input.baseSha}..${actualHead}`,
    ],
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
