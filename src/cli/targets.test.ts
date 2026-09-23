import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runGit, type GitRunResult } from './git-runner.ts';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import { Shell } from './git.ts';
import { repoFromUrl, resolveTarget, slugify } from './targets.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

const NO_PR: GitRunResult = { stdout: '', stderr: 'no pull requests found', exitCode: 1 };

type GhReply = (args: readonly string[]) => GitRunResult;

let repo: TempRepo;
let initial: string;

beforeEach(() => {
  repo = createTempRepo();
  initial = repo.git('rev-parse', 'HEAD').trim();
});
afterEach(() => repo.cleanup());

function shell(gh: GhReply = () => NO_PR): { shell: Shell; ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  const runners = {
    git: runGit,
    gh: async (opts: { args: readonly string[] }) => {
      ghCalls.push([...opts.args]);
      return gh(opts.args);
    },
  };
  return { shell: new Shell(repo.work, runners), ghCalls };
}

function json(value: unknown): GitRunResult {
  return { stdout: JSON.stringify(value), stderr: '', exitCode: 0 };
}

/** A feature branch two commits past `initial`, with `main` moved on since. */
function branchWithMovedMain(): string {
  repo.git('checkout', '--quiet', '-b', 'feat/login-form');
  repo.write('src/login.ts', 'export const login = 1;\n');
  repo.commit('add login');
  repo.write('src/login.ts', 'export const login = 2;\n');
  const head = repo.commit('tweak login');
  repo.git('checkout', '--quiet', 'main');
  repo.write('CHANGELOG.md', 'moved on\n');
  repo.commit('main moves on');
  repo.git('push', '--quiet', 'origin', 'main');
  repo.git('checkout', '--quiet', 'feat/login-form');
  return head;
}

/**
 * `feature` forks off `stack-base`, which is then rebased onto a `main` that
 * has moved on, and pushed. `feature` still carries the old `stack-base`
 * commit, so its plain merge-base with the new `stack-base` is `initial`,
 * and that commit's file would be swept into the review.
 */
function rebasedStack(): { head: string; forkedAt: string } {
  repo.git('checkout', '--quiet', '-b', 'stack-base');
  repo.write('src/old-base.ts', 'export const old = 1;\n');
  const forkedAt = repo.commit('stack-base work');
  repo.git('push', '--quiet', 'origin', 'stack-base');
  repo.git('checkout', '--quiet', '-b', 'feature');
  repo.write('src/feature.ts', 'export const x = 1;\n');
  const head = repo.commit('feature work');
  repo.git('checkout', '--quiet', 'main');
  repo.write('CHANGELOG.md', 'main moved on\n');
  repo.commit('main moves on');
  repo.git('checkout', '--quiet', 'stack-base');
  repo.git('rebase', '--quiet', 'main');
  repo.git('push', '--quiet', '--force', 'origin', 'stack-base');
  repo.git('checkout', '--quiet', 'feature');
  return { head, forkedAt };
}

const warn = vi.fn();
beforeEach(() => warn.mockReset());

describe('branch target', () => {
  it('reviews HEAD against its merge-base with the default branch', async () => {
    const head = branchWithMovedMain();
    repo.git('remote', 'set-head', 'origin', 'main');

    const { target, meta } = await resolveTarget({ kind: 'branch', base: null }, shell().shell, {
      warn,
    });

    expect(target).toEqual({
      kind: 'branch',
      slug: 'branch-feat-login-form',
      repoRoot: path.resolve(realpathSync.native(repo.work)),
      baseSha: initial,
      headSha: head,
      baseLabel: 'origin/main',
      headLabel: 'feat/login-form',
    });
    expect(meta).toEqual({
      repo: 'work',
      title: 'feat/login-form',
      prNumber: null,
      baseRefName: 'main',
      headRefName: 'feat/login-form',
      authorLogin: null,
      description: null,
      stats: null,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('asks GitHub for the default branch when origin/HEAD is not set', async () => {
    branchWithMovedMain();
    const { shell: sh, ghCalls } = shell((args) =>
      args[0] === 'repo' ? { stdout: 'main\n', stderr: '', exitCode: 0 } : NO_PR,
    );

    const { target } = await resolveTarget({ kind: 'branch', base: null }, sh, { warn });

    expect(target.baseLabel).toBe('origin/main');
    expect(ghCalls.map((args) => args.slice(0, 2).join(' '))).toEqual(['pr view', 'repo view']);
  });

  it('says how to proceed when the default branch cannot be found', async () => {
    branchWithMovedMain();
    await expect(
      resolveTarget({ kind: 'branch', base: null }, shell().shell, { warn }),
    ).rejects.toThrow(/cannot tell origin's default branch.*--base <ref>/);
  });

  it("follows an open PR's base branch and takes its header", async () => {
    repo.git('push', '--quiet', 'origin', 'main:release');
    const head = branchWithMovedMain();
    const pull = {
      number: 12,
      title: 'Add a login form',
      body: 'Adds the form.',
      author: { login: 'octo' },
      baseRefName: 'release',
      headRefName: 'feat/login-form',
      headRefOid: head,
      state: 'OPEN',
    };

    const { target, meta } = await resolveTarget(
      { kind: 'branch', base: null },
      shell(() => json(pull)).shell,
      { warn },
    );

    expect(target.baseLabel).toBe('origin/release');
    expect(target.baseSha).toBe(initial);
    expect(meta).toMatchObject({
      title: 'Add a login form',
      prNumber: 12,
      baseRefName: 'release',
      headRefName: 'feat/login-form',
      authorLogin: 'octo',
      description: 'Adds the form.',
    });
  });

  it('ignores a closed PR for the branch', async () => {
    const head = branchWithMovedMain();
    repo.git('remote', 'set-head', 'origin', 'main');
    const closed = {
      number: 3,
      title: 'Old attempt',
      body: '',
      author: null,
      baseRefName: 'main',
      headRefName: 'feat/login-form',
      headRefOid: head,
      state: 'CLOSED',
    };

    const { meta } = await resolveTarget(
      { kind: 'branch', base: null },
      shell(() => json(closed)).shell,
      { warn },
    );

    expect(meta.prNumber).toBeNull();
    expect(meta.title).toBe('feat/login-form');
  });

  it('takes --base as given, without fetching', async () => {
    branchWithMovedMain();
    const { target, meta } = await resolveTarget({ kind: 'branch', base: 'main' }, shell().shell, {
      warn,
    });
    expect(target.baseLabel).toBe('main');
    expect(target.baseSha).toBe(initial);
    expect(meta.baseRefName).toBe('main');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and uses the local copy when origin cannot be reached', async () => {
    branchWithMovedMain();
    repo.git('remote', 'set-head', 'origin', 'main');
    repo.git('remote', 'set-url', 'origin', path.join(repo.origin, '..', 'gone.git'));

    const { target } = await resolveTarget({ kind: 'branch', base: null }, shell().shell, {
      warn,
    });

    expect(target.baseSha).toBe(initial);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/^could not fetch origin\/main .*local copy$/);
  });

  it('refuses a branch with nothing past its base', async () => {
    repo.git('remote', 'set-head', 'origin', 'main');
    await expect(
      resolveTarget({ kind: 'branch', base: null }, shell().shell, { warn }),
    ).rejects.toThrow('nothing to review: main has no commits past origin/main');
  });

  it('reviews from where it forked off a --base that was rewritten since', async () => {
    const { head, forkedAt } = rebasedStack();

    const { target } = await resolveTarget({ kind: 'branch', base: 'stack-base' }, shell().shell, {
      warn,
    });

    expect(target.baseSha).toBe(forkedAt);
    expect(target.headSha).toBe(head);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(
      new RegExp(`^stack-base was rewritten .* fork point .* pass --base ${initial}$`),
    );
  });

  it('keeps the merge-base for work moved off a base that was reset behind it', async () => {
    repo.write('src/oops.ts', 'export const oops = 1;\n');
    const head = repo.commit('committed to main by mistake');
    repo.git('branch', 'feat/moved');
    repo.git('reset', '--quiet', '--hard', initial);
    repo.git('checkout', '--quiet', 'feat/moved');

    const { target } = await resolveTarget({ kind: 'branch', base: 'main' }, shell().shell, {
      warn,
    });

    expect(target.baseSha).toBe(initial);
    expect(target.headSha).toBe(head);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reviews work moved off a reset base as its own, once the branch has moved on', async () => {
    repo.write('src/oops.ts', 'export const oops = 1;\n');
    const moved = repo.commit('committed to main by mistake');
    repo.git('branch', 'feat/moved');
    repo.git('reset', '--quiet', '--hard', initial);
    repo.git('checkout', '--quiet', 'feat/moved');
    repo.write('src/more.ts', 'export const more = 1;\n');
    repo.commit('more work');

    const { target } = await resolveTarget({ kind: 'branch', base: 'main' }, shell().shell, {
      warn,
    });

    expect(target.baseSha).toBe(initial);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(
      new RegExp(`^main no longer has 1 commit this change carries .* pass --base ${moved}$`),
    );
  });

  it('falls back to the merge-base when the base has no reflog to find the fork in', async () => {
    rebasedStack();
    const tip = repo.git('rev-parse', 'stack-base').trim();

    const { target } = await resolveTarget({ kind: 'branch', base: tip }, shell().shell, { warn });

    expect(target.baseSha).toBe(initial);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('staged target', () => {
  it('commits the index on top of HEAD without touching the index or working tree', async () => {
    repo.write('README.md', '# fixture\n\nstaged line\n');
    repo.write('notes.txt', 'new file\n');
    repo.git('add', 'README.md', 'notes.txt');
    repo.write('README.md', '# fixture\n\nstaged line\nunstaged line\n');
    const statusBefore = repo.git('status', '--porcelain');

    const { target, meta } = await resolveTarget({ kind: 'staged' }, shell().shell, { warn });

    expect(repo.git('status', '--porcelain')).toBe(statusBefore);
    expect(target).toMatchObject({
      kind: 'staged',
      slug: 'staged',
      baseSha: initial,
      baseLabel: 'HEAD',
    });
    expect(repo.git('rev-parse', `${target.headSha}^`).trim()).toBe(initial);
    expect(repo.git('show', `${target.headSha}:README.md`)).toBe('# fixture\n\nstaged line\n');
    expect(repo.git('show', `${target.headSha}:notes.txt`)).toBe('new file\n');
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(initial);
    expect(meta).toMatchObject({
      title: 'Staged changes on main',
      baseRefName: 'main',
      headRefName: 'staged',
      prNumber: null,
    });
  });

  it('refuses an empty index, whatever the working tree holds', async () => {
    repo.write('README.md', 'unstaged edit\n');
    await expect(resolveTarget({ kind: 'staged' }, shell().shell, { warn })).rejects.toThrow(
      'nothing staged',
    );
  });
});

describe('pr target', () => {
  function pushPull(): string {
    const head = branchWithMovedMain();
    repo.git('push', '--quiet', 'origin', 'feat/login-form:refs/pull/7/head');
    repo.git('checkout', '--quiet', 'main');
    return head;
  }

  const pullJson = (headRefOid: string, baseRefName = 'main') =>
    json({
      number: 7,
      title: 'Add a login form',
      body: '',
      author: { login: 'octo' },
      baseRefName,
      headRefName: 'feat/login-form',
      headRefOid,
      state: 'OPEN',
    });

  it("fetches pull/<n>/head and diffs it against its merge-base with the PR's base", async () => {
    const head = pushPull();
    const { target, meta } = await resolveTarget(
      { kind: 'pr', number: 7, base: null },
      shell(() => pullJson(head)).shell,
      { warn },
    );
    expect(target).toMatchObject({
      kind: 'pr',
      slug: 'pr-7',
      baseSha: initial,
      headSha: head,
      baseLabel: 'origin/main',
      headLabel: 'pull/7/head',
    });
    expect(meta).toMatchObject({
      title: 'Add a login form',
      prNumber: 7,
      baseRefName: 'main',
      headRefName: 'feat/login-form',
      authorLogin: 'octo',
      description: null,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reviews from where it forked off a PR base that was rewritten since', async () => {
    const { head, forkedAt } = rebasedStack();
    repo.git('push', '--quiet', 'origin', 'feature:refs/pull/7/head');

    const { target } = await resolveTarget(
      { kind: 'pr', number: 7, base: null },
      shell(() => pullJson(head, 'stack-base')).shell,
      { warn },
    );

    expect(target.baseLabel).toBe('origin/stack-base');
    expect(target.baseSha).toBe(forkedAt);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/^origin\/stack-base was rewritten/);
  });

  it('refuses when the PR moved between asking and fetching', async () => {
    pushPull();
    await expect(
      resolveTarget({ kind: 'pr', number: 7, base: null }, shell(() => pullJson(initial)).shell, {
        warn,
      }),
    ).rejects.toThrow('PR #7 changed while it was being fetched; run again');
  });
});

it('refuses to run outside a repository', async () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'cli-test-outside-'));
  try {
    await expect(resolveTarget({ kind: 'staged' }, new Shell(outside), { warn })).rejects.toThrow(
      'not inside a git repository',
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

describe('repoFromUrl', () => {
  it.each([
    ['https://github.com/acme/widgets.git', 'acme/widgets'],
    ['https://github.com/acme/widgets/', 'acme/widgets'],
    ['git@github.com:acme/widgets.git', 'acme/widgets'],
    ['ssh://git@github.example.com:22/acme/widgets', 'acme/widgets'],
    ['C:/repos/origin.git', null],
    ['/srv/git/origin.git', null],
  ])('%s → %s', (url, expected) => {
    expect(repoFromUrl(url)).toBe(expected);
  });
});

describe('slugify', () => {
  it.each([
    ['feat/er-13-local-review-cli', 'feat-er-13-local-review-cli'],
    ['fix: spaces * and stars', 'fix-spaces-and-stars'],
    ['.hidden/trailing.', 'hidden-trailing'],
    ['///', 'head'],
  ])('%s → %s', (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });
});
