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
    args: ['diff', '--numstat', '-z', `${base}..${head}`],
    cwd,
    signal,
  });
  const status = await runGitOrThrow(git, 'diff --name-status', {
    args: ['diff', '--name-status', '-z', `${base}..${head}`],
    cwd,
    signal,
  });
  return mergeFileLists(numstat.stdout, status.stdout);
}

/**
 * Joins `git diff --numstat -z` (counts) with `git diff --name-status -z`
 * (kinds) on the new path, so renames and copies report the new name with
 * their real counts. Both inputs are NUL-separated: that is the only form in
 * which a rename is unambiguous (the line form collapses it into a single
 * `old => new` column that never matches the two-column name-status record)
 * and it also sidesteps git's quoting of paths with spaces or non-ASCII
 * bytes. Binary files show `-` counts and become 0/0.
 */
export function mergeFileLists(numstatZ: string, nameStatusZ: string): ReviewFile[] {
  const counts = new Map<string, { additions: number; deletions: number }>();
  // `<add>\t<del>\t<path>\0`, or `<add>\t<del>\t\0<old>\0<new>\0` for a
  // rename/copy — the empty third field is the marker for the two that follow.
  const numFields = splitRecords(numstatZ);
  for (let i = 0; i < numFields.length; i += 1) {
    const parts = numFields[i].split('\t');
    if (parts.length < 3) continue;
    let filename = parts[2];
    if (filename === '') {
      // Rename/copy: the old and new paths are the next two fields.
      if (i + 2 >= numFields.length) break;
      filename = numFields[i + 2];
      i += 2;
    }
    counts.set(filename, { additions: parseCount(parts[0]), deletions: parseCount(parts[1]) });
  }

  // `<status>\0<path>\0`, or `<status>\0<old>\0<new>\0` when the status is R/C.
  const files: ReviewFile[] = [];
  const statusFields = splitRecords(nameStatusZ);
  for (let i = 0; i < statusFields.length; i += 2) {
    const code = statusFields[i].charAt(0).toUpperCase();
    const renamed = code === 'R' || code === 'C';
    const pathAt = renamed ? i + 2 : i + 1;
    if (pathAt >= statusFields.length) break;
    const filename = statusFields[pathAt];
    if (renamed) i += 1;
    const c = counts.get(filename) ?? { additions: 0, deletions: 0 };
    files.push({ filename, status: STATUS_MAP[code] ?? 'modified', ...c });
  }
  return files;
}

/** NUL-separated fields, minus the trailing empty one git leaves behind. */
function splitRecords(out: string): string[] {
  return out.split('\0').filter((field) => field !== '');
}

function parseCount(raw: string | undefined): number {
  if (raw === undefined || raw === '-') return 0;
  return Number.parseInt(raw, 10) || 0;
}
