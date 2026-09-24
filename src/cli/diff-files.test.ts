import { describe, expect, it } from 'vitest';
import {
  baseOrigins,
  listChangedFileDetails,
  parseHistory,
  parseChangedFiles,
  TruncatedGitOutputError,
  type ChangedFile,
} from './diff-files.ts';
import type { GitRunner } from './git-runner.ts';
import type { ReviewFileStatus } from '../review/narrative.ts';

/** `git diff --numstat -z` output: every field is NUL-terminated. */
function numstatZ(...fields: string[]): string {
  return fields.map((f) => `${f}\0`).join('');
}
const nameStatusZ = numstatZ;

/** One expected record; the cases that are not about renames or binaries take the defaults. */
function file(
  filename: string,
  status: ReviewFileStatus,
  additions: number,
  deletions: number,
  extra: Partial<ChangedFile> = {},
): ChangedFile {
  return {
    filename,
    status,
    additions,
    deletions,
    binary: false,
    ...extra,
  };
}

describe('parseChangedFiles', () => {
  it('joins counts and statuses on the filename', () => {
    expect(
      parseChangedFiles(
        numstatZ('10\t2\tsrc/a.ts', '0\t5\tsrc/b.ts'),
        nameStatusZ('M', 'src/a.ts', 'D', 'src/b.ts'),
      ),
    ).toEqual([file('src/a.ts', 'modified', 10, 2), file('src/b.ts', 'removed', 0, 5)]);
  });

  it('keeps the counts, the old path and the similarity of a rename that also changed lines', () => {
    // `-z` splits a rename into an empty third numstat field plus two paths;
    // the old line format collapsed it to `old.ts => new.ts` and never joined.
    expect(
      parseChangedFiles(
        numstatZ('4\t3\t', 'old.ts', 'new.ts'),
        nameStatusZ('R077', 'old.ts', 'new.ts'),
      ),
    ).toEqual([
      file('new.ts', 'renamed', 4, 3, { origin: { filename: 'old.ts', similarity: 77 } }),
    ]);
  });

  it('handles a rename whose paths share a directory prefix', () => {
    // The line format writes this as `src/{a => b}/x.ts`.
    expect(
      parseChangedFiles(
        numstatZ('1\t1\t', 'src/a/x.ts', 'src/b/x.ts'),
        nameStatusZ('R100', 'src/a/x.ts', 'src/b/x.ts'),
      ),
    ).toEqual([
      file('src/b/x.ts', 'renamed', 1, 1, { origin: { filename: 'src/a/x.ts', similarity: 100 } }),
    ]);
  });

  it('reports a copy under the new name', () => {
    expect(
      parseChangedFiles(
        numstatZ('0\t0\t', 'src/x.ts', 'src/y.ts'),
        nameStatusZ('C100', 'src/x.ts', 'src/y.ts'),
      ),
    ).toEqual([
      file('src/y.ts', 'copied', 0, 0, { origin: { filename: 'src/x.ts', similarity: 100 } }),
    ]);
  });

  it('keeps ordinary entries straight when a rename sits between them', () => {
    expect(
      parseChangedFiles(
        numstatZ('1\t0\tsrc/a.ts', '2\t2\t', 'old.ts', 'new.ts', '0\t3\tsrc/c.ts'),
        nameStatusZ('M', 'src/a.ts', 'R090', 'old.ts', 'new.ts', 'M', 'src/c.ts'),
      ),
    ).toEqual([
      file('src/a.ts', 'modified', 1, 0),
      file('new.ts', 'renamed', 2, 2, { origin: { filename: 'old.ts', similarity: 90 } }),
      file('src/c.ts', 'modified', 0, 3),
    ]);
  });

  it('marks binary files, zeroes their "-" counts, and treats unknown codes as modified', () => {
    expect(
      parseChangedFiles(numstatZ('-\t-\tlogo.png'), nameStatusZ('A', 'logo.png', 'X', 'weird')),
    ).toEqual([file('logo.png', 'added', 0, 0, { binary: true }), file('weird', 'modified', 0, 0)]);
  });

  it('separates an empty file from a binary one', () => {
    // Both report no lines; only the binary one reports them as `-`.
    expect(parseChangedFiles(numstatZ('0\t0\tempty.txt'), nameStatusZ('A', 'empty.txt'))).toEqual([
      file('empty.txt', 'added', 0, 0),
    ]);
  });

  it('carries paths with spaces and non-ASCII bytes through unquoted', () => {
    expect(
      parseChangedFiles(
        numstatZ('1\t0\tdocs/notes für mich.md'),
        nameStatusZ('A', 'docs/notes für mich.md'),
      ),
    ).toEqual([file('docs/notes für mich.md', 'added', 1, 0)]);
  });

  it('ignores a numstat record with too few columns', () => {
    expect(parseChangedFiles('', '')).toEqual([]);
    expect(parseChangedFiles(numstatZ('not-a-numstat'), nameStatusZ('M', 'f.txt'))).toEqual([
      file('f.txt', 'modified', 0, 0),
    ]);
  });

  it('throws when either list ends mid-record rather than returning a short one', () => {
    // A file dropped here is a file the prompt never lists and coverage never
    // counts, while its patch is still in the diff: silence is the one answer
    // that cannot be noticed.
    expect(() => parseChangedFiles(numstatZ('1\t1\t', 'old.ts'), nameStatusZ())).toThrow(
      TruncatedGitOutputError,
    );
    expect(() => parseChangedFiles(numstatZ('1\t1\tf.txt'), nameStatusZ('M'))).toThrow(
      TruncatedGitOutputError,
    );
  });
});

describe('listChangedFileDetails', () => {
  const pins = ['--no-color', '--no-ext-diff', '--no-textconv'];

  /** A fake git: each call answered by the first rule whose test matches its arguments. */
  function fakeGit(rules: [(args: readonly string[]) => boolean, string][]) {
    const calls: string[][] = [];
    const git: GitRunner = async (opts) => {
      calls.push([...opts.args]);
      const rule = rules.find(([test]) => test(opts.args));
      return { stdout: rule?.[1] ?? '', stderr: '', exitCode: 0 };
    };
    return { git, calls };
  }
  const isRange = (kind: string) => (args: readonly string[]) =>
    args[0] !== 'log' && args.includes(kind) && args.at(-1) === 'base..head';
  const isPair = (kind: string) => (args: readonly string[]) =>
    args.includes(kind) && args.includes('--find-renames=1%');
  const isLog = (args: readonly string[]) => args[0] === 'log';

  it('runs numstat and name-status against the range and merges them', async () => {
    const { git, calls } = fakeGit([
      [isRange('--numstat'), numstatZ('3\t1\tf.txt')],
      [isRange('--name-status'), nameStatusZ('M', 'f.txt')],
    ]);
    await expect(listChangedFileDetails(git, '/work', 'base', 'head')).resolves.toEqual([
      file('f.txt', 'modified', 3, 1),
    ]);
    // The diff drivers a repository can name in its own `.gitattributes` are
    // refused here too: numstat honours textconv, and would then count lines
    // for a file the reviewed diff carries only as "Binary files ... differ".
    // Renames are asked for explicitly: a repository's own `diff.renames`
    // could otherwise turn them off here while the patch still pairs them.
    // With nothing removed there is nothing to pair, so the history is not read.
    expect(calls).toEqual([
      ['--literal-pathspecs', 'diff', '--numstat', '-z', '--find-renames', ...pins, 'base..head'],
      [
        '--literal-pathspecs',
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        ...pins,
        'base..head',
      ],
    ]);
  });

  it('rediffs a removed and an added path the history connects, and lists them as one rename', async () => {
    const { git, calls } = fakeGit([
      [isPair('--numstat'), numstatZ('7\t5\t', 'old.ts', 'new.ts')],
      [isPair('--name-status'), nameStatusZ('R031', 'old.ts', 'new.ts')],
      [isRange('--numstat'), numstatZ('0\t9\told.ts', '11\t0\tnew.ts', '1\t1\tkeep.ts')],
      [isRange('--name-status'), nameStatusZ('D', 'old.ts', 'A', 'new.ts', 'M', 'keep.ts')],
      [isLog, nameStatusZ('R100', 'old.ts', 'mid.ts', 'R100', 'mid.ts', 'new.ts')],
    ]);
    await expect(listChangedFileDetails(git, '/work', 'base', 'head')).resolves.toEqual([
      file('new.ts', 'renamed', 7, 5, { origin: { filename: 'old.ts', similarity: 31 } }),
      file('keep.ts', 'modified', 1, 1),
    ]);
    expect(calls.find(isLog)).toEqual([
      'log',
      '--topo-order',
      '--reverse',
      '-z',
      '--format=',
      '--name-status',
      '--find-renames',
      '--diff-filter=AR',
      ...pins,
      'base..head',
    ]);
    expect(calls.find(isPair('--name-status'))).toEqual([
      '--literal-pathspecs',
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      ...pins,
      '--find-renames=1%',
      'base..head',
      '--',
      'old.ts',
      'new.ts',
    ]);
  });

  it('leaves the two apart when git will not pair them even at 1%', async () => {
    const { git } = fakeGit([
      [isPair('--numstat'), numstatZ('0\t9\told.ts', '2\t0\tnew.ts')],
      [isPair('--name-status'), nameStatusZ('D', 'old.ts', 'A', 'new.ts')],
      [isRange('--numstat'), numstatZ('0\t9\told.ts', '2\t0\tnew.ts')],
      [isRange('--name-status'), nameStatusZ('D', 'old.ts', 'A', 'new.ts')],
      [isLog, nameStatusZ('R100', 'old.ts', 'new.ts')],
    ]);
    await expect(listChangedFileDetails(git, '/work', 'base', 'head')).resolves.toEqual([
      file('old.ts', 'removed', 0, 9),
      file('new.ts', 'added', 2, 0),
    ]);
  });

  it('does not pair a path whose base file the branch kept', async () => {
    // `old.ts` was moved and then written again at the same path: it is
    // modified over the range, not removed, so it has no file to give away.
    const { git, calls } = fakeGit([
      [isRange('--numstat'), numstatZ('1\t1\told.ts', '2\t0\tnew.ts', '0\t3\tgone.ts')],
      [isRange('--name-status'), nameStatusZ('M', 'old.ts', 'A', 'new.ts', 'D', 'gone.ts')],
      [isLog, nameStatusZ('R100', 'old.ts', 'new.ts', 'A', 'old.ts')],
    ]);
    await expect(listChangedFileDetails(git, '/work', 'base', 'head')).resolves.toHaveLength(3);
    expect(calls.some(isPair('--numstat'))).toBe(false);
  });
});

describe('parseHistory', () => {
  it('reads each creation and rename, in the order git printed them', () => {
    expect(
      parseHistory(nameStatusZ('R100', 'a.ts', 'b.ts', 'A', 'a.ts', 'R087', 'b.ts', 'c.ts')),
    ).toEqual([
      { kind: 'renamed', from: 'a.ts', to: 'b.ts' },
      { kind: 'added', path: 'a.ts' },
      { kind: 'renamed', from: 'b.ts', to: 'c.ts' },
    ]);
    expect(parseHistory('')).toEqual([]);
  });

  it('throws on a record cut off before its paths', () => {
    expect(() => parseHistory(nameStatusZ('R100', 'a.ts'))).toThrow(TruncatedGitOutputError);
    expect(() => parseHistory(nameStatusZ('A'))).toThrow(TruncatedGitOutputError);
  });
});

describe('baseOrigins', () => {
  const moved = (from: string, to: string) => ({ kind: 'renamed' as const, from, to });
  const created = (path: string) => ({ kind: 'added' as const, path });

  it('follows a file through every move to the path it had at the base', () => {
    const originOf = baseOrigins([
      moved('a.ts', 'b.ts'),
      moved('x.ts', 'y.ts'),
      moved('b.ts', 'c.ts'),
    ]);
    expect(Object.fromEntries(originOf)).toEqual({ 'c.ts': 'a.ts', 'y.ts': 'x.ts' });
  });

  it('forgets a move that a later one undid', () => {
    expect(Object.fromEntries(baseOrigins([moved('a.ts', 'b.ts'), moved('b.ts', 'a.ts')]))).toEqual(
      {},
    );
  });

  it('gives a file created on the branch no base path, wherever it moves', () => {
    // Without the creation, `d.ts` would claim `a.ts` too, and one removed
    // file would become the origin of two renames.
    const originOf = baseOrigins([moved('a.ts', 'b.ts'), created('a.ts'), moved('a.ts', 'd.ts')]);
    expect(Object.fromEntries(originOf)).toEqual({ 'b.ts': 'a.ts' });
  });
});
