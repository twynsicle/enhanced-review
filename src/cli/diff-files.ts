import type { ReviewFile, ReviewFileOrigin, ReviewFileStatus } from '../review/narrative.ts';
import { mapLimit, PARALLEL_GIT, runGitOrThrow, type GitRunner } from './git-runner.ts';

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

/**
 * Renames and copies are asked for rather than left to `diff.renames`, which
 * the reviewed repository's own config can turn off; the patch the model reads
 * pairs the same files. `--find-copies-harder` looks for a copy's source among
 * every file at the base, not only the ones the branch touched: a new file is
 * most often cloned from one nobody changed.
 *
 * `-l0` lifts git's rename limit. Past it, git drops back to copies of
 * modified files only and says so on stderr alone, so in a large tree copy
 * detection would stop without anyone being told. What the lift costs is paid
 * knowingly: the comparisons grow with added files times files at the base.
 */
const FIND_ORIGINS = ['--find-copies', '--find-copies-harder', '-l0'] as const;

/**
 * The changed files between two commits: per-file counts, rename and copy
 * origins, binary flags.
 *
 * Git scores a rename over the whole range, and a file that was moved in one
 * commit and rewritten in a later one — or re-indented, since whitespace
 * counts in the score — falls under its 50% threshold and comes back as one
 * file removed and another added. The branch's own commits still record the
 * move, each one scored when it happened, so a removed and an added path that
 * the history connects are diffed again as a pair. Lowering the threshold for
 * the whole range instead would let git pair unrelated files that share
 * boilerplate.
 */
export async function listChangedFileDetails(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  signal?: AbortSignal,
): Promise<ChangedFile[]> {
  const range = `${base}..${head}`;
  const files = await changedFiles(git, cwd, [range], signal);
  const removed = new Set(files.filter((f) => f.status === 'removed').map((f) => f.filename));
  const added = files.filter((f) => f.status === 'added');
  // Walking every commit's renames is the dearest git call here; with nothing
  // on one side there is nothing it could pair.
  if (removed.size === 0 || added.length === 0) return files;

  const log = await runGitOrThrow(git, 'log --name-status', {
    args: [
      'log',
      // Parents before children: date order can put a later move first when
      // commits share a timestamp, as a rebased stack's do, and break a chain.
      '--topo-order',
      '--reverse',
      '-z',
      '--format=',
      '--name-status',
      '--find-renames',
      '--diff-filter=AR',
      ...DIFF_PINS,
      range,
    ],
    cwd,
    signal,
  });
  const originOf = baseOrigins(parseHistory(log.stdout));
  const requests = added.flatMap((file) => {
    const from = originOf.get(file.filename);
    return from !== undefined && removed.has(from) ? [{ from, to: file.filename }] : [];
  });
  return (await pairFiles(git, cwd, base, head, files, requests, signal)).files;
}

/** A path at the base that an added file is claimed to have come from. */
export interface PairRequest {
  from: string;
  to: string;
}

/**
 * Diffs each requested pair on its own and lists the added file as a rename
 * or a copy of its source. Told there are only these two paths, git pairs
 * anything with 1% in common; a pair sharing nothing at all comes back in
 * `unpaired`, since a diff between the two would be every line out and every
 * line in. A source the branch removed becomes a rename and leaves the list.
 */
export async function pairFiles(
  git: GitRunner,
  cwd: string,
  base: string,
  head: string,
  files: readonly ChangedFile[],
  requests: readonly PairRequest[],
  signal?: AbortSignal,
): Promise<{ files: ChangedFile[]; unpaired: PairRequest[] }> {
  const range = `${base}..${head}`;
  // Halved: each pair runs its two git diffs at once.
  const pairs = await mapLimit(requests, PARALLEL_GIT / 2, async ({ from, to }) => {
    // A copy's source can be listed beside it, modified on the branch.
    const listed = await changedFiles(
      git,
      cwd,
      ['--find-copies=1%', range, '--', from, to],
      signal,
    );
    return listed.find((f) => f.filename === to && f.origin?.filename === from) ?? null;
  });
  const pairedTo = new Map<string, ChangedFile>();
  const consumed = new Set<string>();
  const unpaired: PairRequest[] = [];
  pairs.forEach((pair, index) => {
    if (!pair?.origin) {
      unpaired.push(requests[index]!);
      return;
    }
    pairedTo.set(pair.filename, pair);
    if (pair.status !== 'renamed') return;
    if (consumed.has(pair.origin.filename)) {
      throw new Error(`two files were paired as renames of ${pair.origin.filename}`);
    }
    consumed.add(pair.origin.filename);
  });
  return {
    files: files.flatMap((f) => (consumed.has(f.filename) ? [] : [pairedTo.get(f.filename) ?? f])),
    unpaired,
  };
}

/** numstat joined to name-status for one `git diff` (the range, or a pair of paths within it). */
async function changedFiles(
  git: GitRunner,
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<ChangedFile[]> {
  const diff = (kind: '--numstat' | '--name-status') =>
    runGitOrThrow(git, `diff ${kind}`, {
      args: ['--literal-pathspecs', 'diff', kind, '-z', ...FIND_ORIGINS, ...DIFF_PINS, ...args],
      cwd,
      signal,
    });
  const [numstat, status] = await Promise.all([diff('--numstat'), diff('--name-status')]);
  return parseChangedFiles(numstat.stdout, status.stdout);
}

/** One path a commit created, or one it moved. */
export type HistoryEntry =
  { kind: 'added'; path: string } | { kind: 'renamed'; from: string; to: string };

/**
 * `git log --name-status -z --diff-filter=AR`: `A\0<path>\0` per file created
 * and `R<score>\0<old>\0<new>\0` per rename, oldest commit first.
 */
export function parseHistory(logZ: string): HistoryEntry[] {
  const fields = splitRecords(logZ);
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === 'A') {
      if (i + 1 >= fields.length) throw new TruncatedGitOutputError('log --name-status');
      entries.push({ kind: 'added', path: fields[i + 1] });
      i += 1;
    } else if (/^R\d*$/.test(field)) {
      if (i + 2 >= fields.length) throw new TruncatedGitOutputError('log --name-status');
      entries.push({ kind: 'renamed', from: fields[i + 1], to: fields[i + 2] });
      i += 2;
    }
  }
  return entries;
}

/**
 * The path each file had at the base, by where the commits left it, following
 * a chain of moves (`a → b`, then `b → c`, gives `c → a`). A path created on
 * the branch has no base path, and neither does anything later moved out of
 * it: without that, a file re-created at a path the branch had already moved
 * away from would claim the moved file's origin as its own.
 */
export function baseOrigins(history: readonly HistoryEntry[]): Map<string, string> {
  const originOf = new Map<string, string | null>();
  for (const entry of history) {
    if (entry.kind === 'added') {
      originOf.set(entry.path, null);
      continue;
    }
    const known = originOf.get(entry.from);
    const origin = known === undefined ? entry.from : known;
    originOf.delete(entry.from);
    originOf.set(entry.to, origin);
  }
  return new Map(
    [...originOf].flatMap(([path, origin]) =>
      origin !== null && origin !== path ? [[path, origin] as const] : [],
    ),
  );
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
    if (renamed) i += 1;
    const c = counts.get(filename) ?? { additions: 0, deletions: 0, binary: false };
    // No line in or out of a text file: the same content, whatever the score.
    const origin: ReviewFileOrigin | null = renamed
      ? {
          filename: statusFields[i],
          similarity: similarity(statusFields[i - 1]),
          identical: !c.binary && c.additions === 0 && c.deletions === 0,
        }
      : null;
    files.push({
      filename,
      status: STATUS_MAP[code] ?? 'modified',
      ...(origin ? { origin } : {}),
      ...c,
    });
  }
  return files;
}

/** NUL-separated fields, minus the trailing empty one git leaves behind. */
function splitRecords(out: string): string[] {
  return out.split('\0').filter((field) => field !== '');
}

/** The score git prints after R or C (`R086`); git always prints one, and a bare letter reads as 0. */
function similarity(status: string): number {
  return Math.min(100, Number.parseInt(status.slice(1), 10) || 0);
}

function parseCount(raw: string | undefined): number {
  if (raw === undefined || raw === '-') return 0;
  return Number.parseInt(raw, 10) || 0;
}
