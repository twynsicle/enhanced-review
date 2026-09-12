import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import { Shell } from './git.ts';
import { onInterrupt, runInterruptCleanups } from './interrupts.ts';
import {
  addWorktree,
  removeWorktree,
  removeWorktreeSync,
  sweepStaleWorktrees,
  type Worktree,
} from './worktree.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT });

let repo: TempRepo;
let shell: Shell;
const made: Worktree[] = [];

beforeEach(() => {
  repo = createTempRepo();
  shell = new Shell(repo.work);
});
afterEach(() => {
  for (const worktree of made.splice(0)) removeWorktreeSync(worktree);
  repo.cleanup();
});

async function worktreeOfHead(): Promise<Worktree> {
  const head = repo.git('rev-parse', 'HEAD').trim();
  const worktree = await addWorktree(shell, 7, head, new Date(2026, 8, 11, 10, 0, 0));
  made.push(worktree);
  return worktree;
}

const listed = () => repo.git('worktree', 'list', '--porcelain');
const inList = (worktree: Worktree) =>
  listed().toLowerCase().includes(path.basename(worktree.path).toLowerCase());

describe('PR worktrees', () => {
  it('checks out the head, detached, in the temp dir, named for the PR and this process', async () => {
    const worktree = await worktreeOfHead();
    expect(path.basename(worktree.path)).toBe(`er-pr7-${String(process.pid)}-20260911-100000`);
    expect(readFileSync(path.join(worktree.path, 'README.md'), 'utf8')).toBe('# fixture\n');
    expect(inList(worktree)).toBe(true);
    expect(listed()).toContain('detached');
  });

  it('runs none of the repository’s hooks', async () => {
    repo.write(
      '.git/hooks/post-checkout',
      '#!/bin/sh\necho ran > "$(git rev-parse --show-toplevel)/hook-ran"\n',
    );
    const worktree = await worktreeOfHead();
    expect(existsSync(path.join(worktree.path, 'hook-ran'))).toBe(false);
  });

  it('is removed with its registration', async () => {
    const worktree = await worktreeOfHead();
    await removeWorktree(shell, worktree);
    expect(existsSync(worktree.path)).toBe(false);
    expect(inList(worktree)).toBe(false);
  });

  it('is removed synchronously when an interrupt runs the registered cleanup', async () => {
    const worktree = await worktreeOfHead();
    onInterrupt(() => removeWorktreeSync(worktree));
    runInterruptCleanups();
    expect(existsSync(worktree.path)).toBe(false);
    expect(inList(worktree)).toBe(false);
  });

  it('sweeps worktrees whose process is gone and keeps live ones', async () => {
    const worktree = await worktreeOfHead();
    await expect(sweepStaleWorktrees(shell, () => true)).resolves.toEqual([]);
    expect(existsSync(worktree.path)).toBe(true);

    const swept = await sweepStaleWorktrees(shell, () => false);
    expect(swept.map((dir) => path.basename(dir))).toEqual([path.basename(worktree.path)]);
    expect(existsSync(worktree.path)).toBe(false);
  });
});

describe('interrupt cleanups', () => {
  it('run once each, past a failing one, and not after unregistering', () => {
    const first = vi.fn(() => {
      throw new Error('locked');
    });
    const second = vi.fn();
    const dropped = vi.fn();
    onInterrupt(first);
    onInterrupt(second);
    onInterrupt(dropped)();

    runInterruptCleanups();
    runInterruptCleanups();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(dropped).not.toHaveBeenCalled();
  });
});
