import type { ReviewFile, ReviewFileStatus } from '../review/narrative.ts';
import { runGitOrThrow, type GitRunner } from './git-runner.ts';

const STATUS_MAP: Record<string, ReviewFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
  U: 'modified',
};

/** Git's own output ran out mid-record, so the file list cannot be trusted to be whole. */
export class TruncatedGitOutputError extends Error {
  constructor(command: string) {
    super(`git ${command} ended mid-record; the changed file list is incomplete`);
    this.name = 'TruncatedGitOutputError';
  }
}

/** A changed file with what the reader's list leaves out. */
export interface ChangedFile extends ReviewFile {
  /** The path a renamed or copied file came from; null otherwise. */
  previousFilename: string | null;
  /** numstat reports `-` counts: git sees no text lines to count. */
  binary: boolean;
}

/**
 * The same pins the narrative diff carries. A driver the reviewed repository
 * names in its own `.gitattributes` is the one no environment can disable, and
 * textconv is what these two commands would otherwise disagree over: it gives
 * `--numstat` real line counts for a file the diff prints as binary, and the
 * file then reaches the model as reviewable with no hunks behind it.
 */
const DIFF_PINS = ['--no-color', '--no-ext-diff', '--no-textconv'] as const;

/** The changed files between two commits: per-file counts, rename origins, binary flags. */
export async function listChangedFileDetails(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  signal?: AbortSignal,
): Promise<ChangedFile[]> {
  const range = `${base}..${head}`;
  const numstat = await runGitOrThrow(git, 'diff --numstat', {
    args: ['diff', '--numstat', '-z', ...DIFF_PINS, range],
    cwd,
    signal,
  });
  const status = await runGitOrThrow(git, 'diff --name-status', {
    args: ['diff', '--name-status', '-z', ...DIFF_PINS, range],
    cwd,
    signal,
  });
  return parseChangedFiles(numstat.stdout, status.stdout);
}

/**
 * Joins `git diff --numstat -z` (counts) with `git diff --name-status -z`
 * (kinds) on the new path, so renames and copies report the new name with
 * their real counts. Both inputs are NUL-separated: that is the only form in
 * which a rename is unambiguous (the line form collapses it into a single
 * `old => new` column that never matches the two-column name-status record)
 * and it also sidesteps git's quoting of paths with spaces or non-ASCII
 * bytes. Binary files show `-` counts and become 0/0.
 *
 * A record that ends early throws rather than returning the files read so far:
 * a short list is a file the review never accounts for, and the quiet version
 * of that is a change nobody is told about.
 */
export function parseChangedFiles(numstatZ: string, nameStatusZ: string): ChangedFile[] {
  const counts = new Map<string, { additions: number; deletions: number; binary: boolean }>();
  // `<add>\t<del>\t<path>\0`, or `<add>\t<del>\t\0<old>\0<new>\0` for a
  // rename/copy — the empty third field is the marker for the two that follow.
  const numFields = splitRecords(numstatZ);
  for (let i = 0; i < numFields.length; i += 1) {
    const parts = numFields[i].split('\t');
    if (parts.length < 3) continue;
    let filename = parts[2];
    if (filename === '') {
      // Rename/copy: the old and new paths are the next two fields.
      if (i + 2 >= numFields.length) throw new TruncatedGitOutputError('diff --numstat');
      filename = numFields[i + 2];
      i += 2;
    }
    counts.set(filename, {
      additions: parseCount(parts[0]),
      deletions: parseCount(parts[1]),
      binary: parts[0] === '-' && parts[1] === '-',
    });
  }

  // `<status>\0<path>\0`, or `<status>\0<old>\0<new>\0` when the status is R/C.
  const files: ChangedFile[] = [];
  const statusFields = splitRecords(nameStatusZ);
  for (let i = 0; i < statusFields.length; i += 2) {
    const code = statusFields[i].charAt(0).toUpperCase();
    const renamed = code === 'R' || code === 'C';
    const pathAt = renamed ? i + 2 : i + 1;
    if (pathAt >= statusFields.length) throw new TruncatedGitOutputError('diff --name-status');
    const filename = statusFields[pathAt];
    const previousFilename = renamed ? statusFields[i + 1] : null;
    if (renamed) i += 1;
    const c = counts.get(filename) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ filename, status: STATUS_MAP[code] ?? 'modified', previousFilename, ...c });
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
