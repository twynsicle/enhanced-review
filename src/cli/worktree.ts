import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { Shell } from './git.ts';
import { isInside, NO_HOOKS_PATH, worktreeParent } from './platform.ts';
import { runStamp } from './run-folder.ts';

/**
 * A PR review's working directory (docs/local-mode A1): a detached worktree
 * of the PR head in the OS temp dir, so the agent reads the PR as it is
 * without touching the engineer's checkout. It lives only for the run stage.
 *
 * The name carries the owning process id, so the sweep at the start of a run
 * removes only worktrees whose `er` is gone — a review running in another
 * terminal keeps its own.
 */
export interface Worktree {
  path: string;
  repoRoot: string;
}

const NAME = /^er-pr\d+-(\d+)-\d{8}-\d{6}$/;

export async function addWorktree(
  shell: Shell,
  prNumber: number,
  headSha: string,
  now: Date,
): Promise<Worktree> {
  const dir = path.join(
    worktreeParent(),
    `er-pr${String(prNumber)}-${String(process.pid)}-${runStamp(now)}`,
  );
  // No hooks (a post-checkout hook is the reviewed repo's code) and no LFS
  // downloads: the agent reads pointers, which is enough to review a diff.
  await shell.git(
    [
      '-c',
      `core.hooksPath=${NO_HOOKS_PATH}`,
      'worktree',
      'add',
      '--detach',
      '--quiet',
      dir,
      headSha,
    ],
    { GIT_LFS_SKIP_SMUDGE: '1' },
  );
  return { path: dir, repoRoot: shell.cwd };
}

export async function removeWorktree(shell: Shell, worktree: Worktree): Promise<void> {
  const removed = await shell.tryGit(['worktree', 'remove', '--force', worktree.path]);
  if (removed.exitCode !== 0) {
    // A file held open (an editor, a virus scanner) can defeat git; the
    // folder goes anyway and prune drops the registration.
    rmSync(worktree.path, { recursive: true, force: true });
    await shell.tryGit(['worktree', 'prune']);
  }
}

/** The same, synchronously, for a signal handler that is about to exit. */
export function removeWorktreeSync(worktree: Worktree): void {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: worktree.repoRoot, stdio: 'ignore', windowsHide: true });
  try {
    git(['worktree', 'remove', '--force', worktree.path]);
  } catch {
    rmSync(worktree.path, { recursive: true, force: true });
    try {
      git(['worktree', 'prune']);
    } catch {
      // Nothing left to do: the next run's sweep prunes it.
    }
  }
}

/** Removes this repository's `er` worktrees whose process has gone; returns their paths. */
export async function sweepStaleWorktrees(
  shell: Shell,
  alive: (pid: number) => boolean = isProcessAlive,
): Promise<string[]> {
  const listed = await shell.git(['worktree', 'list', '--porcelain']);
  const stale = listed
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length).trim()))
    .filter((dir) => {
      const match = NAME.exec(path.basename(dir));
      return match !== null && isInside(worktreeParent(), dir) && !alive(Number(match[1]));
    });
  for (const dir of stale) await removeWorktree(shell, { path: dir, repoRoot: shell.cwd });
  await shell.tryGit(['worktree', 'prune']);
  return stale;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, it just is not ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
