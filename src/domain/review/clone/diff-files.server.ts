import type { ReviewFile, ReviewFileStatus } from '../narrative.ts';
import { runGitOrThrow, type GitRunner } from './git-runner.server.ts';

const STATUS_MAP: Record<string, ReviewFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
  U: 'modified',
};

/** The changed files between two commits with per-file line counts. */
export async function listChangedFiles(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  signal?: AbortSignal,
): Promise<ReviewFile[]> {
  const numstat = await runGitOrThrow(git, 'diff --numstat', {
    args: ['diff', '--numstat', `${base}..${head}`],
    cwd,
    signal,
  });
  const status = await runGitOrThrow(git, 'diff --name-status', {
    args: ['diff', '--name-status', `${base}..${head}`],
    cwd,
    signal,
  });
  return mergeFileLists(numstat.stdout, status.stdout);
}

/**
 * Joins `git diff --numstat` (counts) with `git diff --name-status` (kinds)
 * on the final path column, so renames and copies report the new name.
 * Binary files show `-` counts and become 0/0.
 */
export function mergeFileLists(numstatOut: string, nameStatusOut: string): ReviewFile[] {
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of numstatOut.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const filename = parts.at(-1) ?? '';
    counts.set(filename, { additions: parseCount(parts[0]), deletions: parseCount(parts[1]) });
  }

  const files: ReviewFile[] = [];
  for (const line of nameStatusOut.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = (parts[0] ?? '').charAt(0).toUpperCase();
    const filename = parts.at(-1) ?? '';
    const c = counts.get(filename) ?? { additions: 0, deletions: 0 };
    files.push({ filename, status: STATUS_MAP[code] ?? 'modified', ...c });
  }
  return files;
}

function parseCount(raw: string | undefined): number {
  if (raw === undefined || raw === '-') return 0;
  return Number.parseInt(raw, 10) || 0;
}
