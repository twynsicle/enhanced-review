import path from 'node:path';
import { z } from 'zod';
import type { ReviewMeta } from '../review/review-meta.ts';
import type { Shell } from './git.ts';

/**
 * What `er review` reviews, pinned to two commits:
 *
 * - **branch** — HEAD against its merge-base with the base branch: the open
 *   PR's base when the branch has one, otherwise origin's default branch,
 *   fetched first; `--base` overrides either;
 * - **pr** — `pull/<n>/head` against its merge-base with the PR's base, the
 *   three-dot diff GitHub shows;
 * - **staged** — the index, written as a dangling commit on top of HEAD.
 *
 * The meta is the reader's header; its `stats` are left for gather, which is
 * where the file list is known.
 */
export const TargetSchema = z.object({
  kind: z.enum(['pr', 'branch', 'staged']),
  /** The run folder's parent directory: `pr-42`, `branch-feat-x`, `staged`. */
  slug: z.string().min(1),
  repoRoot: z.string().min(1),
  baseSha: z.string().min(1),
  headSha: z.string().min(1),
  /** What the base was measured from, for people: `origin/main`, `HEAD`. */
  baseLabel: z.string().min(1),
  /** What is under review, for people: a branch, `pull/42/head`, `the index`. */
  headLabel: z.string().min(1),
});
export type Target = z.infer<typeof TargetSchema>;

export type TargetRequest =
  | { kind: 'pr'; number: number; base: string | null }
  | { kind: 'branch'; base: string | null }
  | { kind: 'staged' };

export interface ResolvedTarget {
  target: Target;
  meta: ReviewMeta;
}

export interface ResolveOptions {
  warn: (text: string) => void;
}

const PULL_FIELDS = 'number,title,body,author,baseRefName,headRefName,headRefOid,state';

const PullViewSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string(),
  author: z.object({ login: z.string() }).nullish(),
  baseRefName: z.string().min(1),
  headRefName: z.string(),
  headRefOid: z.string().min(1),
  state: z.string(),
});
type PullView = z.infer<typeof PullViewSchema>;

/** Identity for the staged commit, so it works where `user.name` is unset. */
const STAGED_COMMIT_ENV = {
  GIT_AUTHOR_NAME: 'er',
  GIT_AUTHOR_EMAIL: 'er@localhost',
  GIT_COMMITTER_NAME: 'er',
  GIT_COMMITTER_EMAIL: 'er@localhost',
};

export async function resolveTarget(
  request: TargetRequest,
  cwd: Shell,
  options: ResolveOptions,
): Promise<ResolvedTarget> {
  const repoRoot = await findRepoRoot(cwd);
  const shell = cwd.at(repoRoot);
  const repo = await repoLabel(shell, repoRoot);
  switch (request.kind) {
    case 'pr':
      return resolvePull(shell, repo, request.number, request.base);
    case 'branch':
      return resolveBranch(shell, repo, request.base, options);
    case 'staged':
      return resolveStaged(shell, repo);
  }
}

/** Where a target's runs live, found without fetching or diffing: for `--from`. */
export async function locateTarget(
  request: TargetRequest,
  cwd: Shell,
): Promise<{ repoRoot: string; slug: string }> {
  const repoRoot = await findRepoRoot(cwd);
  const shell = cwd.at(repoRoot);
  switch (request.kind) {
    case 'pr':
      return { repoRoot, slug: `pr-${String(request.number)}` };
    case 'staged':
      return { repoRoot, slug: 'staged' };
    case 'branch': {
      const name =
        (await currentBranch(shell)) ?? (await revParse(shell, 'HEAD', 'commit')).slice(0, 7);
      return { repoRoot, slug: `branch-${slugify(name)}` };
    }
  }
}

export async function findRepoRoot(shell: Shell): Promise<string> {
  const result = await shell.tryGit(['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0) throw new Error('not inside a git repository');
  return path.resolve(result.stdout.trim());
}

async function resolvePull(
  shell: Shell,
  repo: string,
  number: number,
  base: string | null,
): Promise<ResolvedTarget> {
  const pull = parsePull(await shell.gh(['pr', 'view', String(number), '--json', PULL_FIELDS]));
  await shell.git([
    'fetch',
    '--quiet',
    'origin',
    `refs/pull/${String(number)}/head`,
    pull.baseRefName,
  ]);
  // FETCH_HEAD names the first refspec: the PR head.
  const headSha = await revParse(shell, 'FETCH_HEAD', 'PR head');
  if (headSha !== pull.headRefOid) {
    throw new Error(`PR #${String(number)} changed while it was being fetched; run again`);
  }
  const baseLabel = base ?? `origin/${pull.baseRefName}`;
  const baseSha = await mergeBase(shell, headSha, baseLabel);
  return {
    target: {
      kind: 'pr',
      slug: `pr-${String(number)}`,
      repoRoot: shell.cwd,
      baseSha,
      headSha,
      baseLabel,
      headLabel: `pull/${String(number)}/head`,
    },
    meta: pullMeta(repo, pull, base),
  };
}

async function resolveBranch(
  shell: Shell,
  repo: string,
  base: string | null,
  { warn }: ResolveOptions,
): Promise<ResolvedTarget> {
  const headSha = await revParse(shell, 'HEAD', 'commit', 'the branch has no commits yet');
  const branch = await currentBranch(shell);
  const pull = branch ? await currentPull(shell) : null;

  let baseLabel = base;
  if (!baseLabel) {
    const baseBranch = pull?.baseRefName ?? (await defaultBranch(shell));
    const fetched = await shell.tryGit(['fetch', '--quiet', 'origin', baseBranch]);
    if (fetched.exitCode !== 0) {
      warn(
        `could not fetch origin/${baseBranch} (${firstLine(fetched.stderr)}); comparing against the local copy`,
      );
    }
    baseLabel = `origin/${baseBranch}`;
  }
  const baseSha = await mergeBase(shell, headSha, baseLabel);
  const name = branch ?? headSha.slice(0, 7);
  if (baseSha === headSha) {
    throw new Error(`nothing to review: ${name} has no commits past ${baseLabel}`);
  }

  return {
    target: {
      kind: 'branch',
      slug: `branch-${slugify(name)}`,
      repoRoot: shell.cwd,
      baseSha,
      headSha,
      baseLabel,
      headLabel: name,
    },
    meta: pull
      ? { ...pullMeta(repo, pull, base), headRefName: name }
      : {
          repo,
          title: name,
          prNumber: null,
          baseRefName: shortRef(baseLabel),
          headRefName: name,
          authorLogin: null,
          description: null,
          stats: null,
        },
  };
}

async function resolveStaged(shell: Shell, repo: string): Promise<ResolvedTarget> {
  const baseSha = await revParse(
    shell,
    'HEAD',
    'commit',
    'a staged review needs a commit to compare against',
  );
  const tree = (await shell.git(['write-tree'])).trim();
  const baseTree = (await shell.git(['rev-parse', 'HEAD^{tree}'])).trim();
  if (tree === baseTree) throw new Error('nothing staged');
  const headSha = (
    await shell.git(
      ['commit-tree', tree, '-p', baseSha, '-m', 'er: staged changes'],
      STAGED_COMMIT_ENV,
    )
  ).trim();
  const on = (await currentBranch(shell)) ?? baseSha.slice(0, 7);
  return {
    target: {
      kind: 'staged',
      slug: 'staged',
      repoRoot: shell.cwd,
      baseSha,
      headSha,
      baseLabel: 'HEAD',
      headLabel: 'the index',
    },
    meta: {
      repo,
      title: `Staged changes on ${on}`,
      prNumber: null,
      baseRefName: on,
      headRefName: 'staged',
      authorLogin: null,
      description: null,
      stats: null,
    },
  };
}

function pullMeta(repo: string, pull: PullView, base: string | null): ReviewMeta {
  return {
    repo,
    title: pull.title,
    prNumber: pull.number,
    baseRefName: base ? shortRef(base) : pull.baseRefName,
    headRefName: pull.headRefName,
    authorLogin: pull.author?.login ?? null,
    description: pull.body.trim() === '' ? null : pull.body,
    stats: null,
  };
}

function parsePull(json: string): PullView {
  const parsed = PullViewSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error(`unexpected gh pr view output: ${parsed.error.message}`);
  return parsed.data;
}

/** The open PR for the checked-out branch, if gh knows of one; anything else is no PR. */
async function currentPull(shell: Shell): Promise<PullView | null> {
  const result = await shell.tryGh(['pr', 'view', '--json', PULL_FIELDS]);
  if (result.exitCode !== 0) return null;
  const parsed = PullViewSchema.safeParse(JSON.parse(result.stdout));
  return parsed.success && parsed.data.state === 'OPEN' ? parsed.data : null;
}

/** origin's default branch: the local `origin/HEAD`, else GitHub's answer. */
export async function defaultBranch(shell: Shell): Promise<string> {
  const local = await shell.tryGit([
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  if (local.exitCode === 0 && local.stdout.trim() !== '') {
    return local.stdout.trim().replace(/^origin\//, '');
  }
  const remote = await shell.tryGh([
    'repo',
    'view',
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  ]);
  if (remote.exitCode === 0 && remote.stdout.trim() !== '') return remote.stdout.trim();
  throw new Error(
    `cannot tell origin's default branch (${firstLine(remote.stderr)}); ` +
      'pass --base <ref>, or run: git remote set-head origin --auto',
  );
}

async function currentBranch(shell: Shell): Promise<string | null> {
  const result = await shell.tryGit(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

async function revParse(
  shell: Shell,
  rev: string,
  what: string,
  missing = `unknown ${what}: ${rev}`,
): Promise<string> {
  const result = await shell.tryGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (result.exitCode !== 0) throw new Error(missing);
  return result.stdout.trim();
}

async function mergeBase(shell: Shell, headSha: string, baseLabel: string): Promise<string> {
  const baseTip = await revParse(shell, baseLabel, 'base');
  const result = await shell.tryGit(['merge-base', headSha, baseTip]);
  if (result.exitCode !== 0) throw new Error(`no common history with ${baseLabel}`);
  return result.stdout.trim();
}

/** `owner/name` from origin's URL; the folder name when there is no GitHub-style remote. */
async function repoLabel(shell: Shell, repoRoot: string): Promise<string> {
  const origin = await shell.tryGit(['remote', 'get-url', 'origin']);
  return (origin.exitCode === 0 && repoFromUrl(origin.stdout.trim())) || path.basename(repoRoot);
}

export function repoFromUrl(url: string): string | null {
  const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^[\w.-]+@[\w.-]+:/.test(url);
  if (!isRemote) return null;
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
  return match ? `${match[1]!}/${match[2]!}` : null;
}

/** A branch name as a folder name, safe on Windows. */
export function slugify(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .slice(0, 80)
      .replace(/^[-.]+|[-.]+$/g, '') || 'head'
  );
}

function shortRef(ref: string): string {
  return ref.replace(/^origin\//, '');
}

function firstLine(text: string): string {
  return (
    text
      .trim()
      .split('\n')[0]
      ?.replace(/^fatal: /, '') || 'no detail'
  );
}
