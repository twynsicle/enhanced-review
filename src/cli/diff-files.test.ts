import { describe, expect, it } from 'vitest';
import {
  baseOrigins,
  listChangedFileDetails,
  pairFiles,
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
      file('new.ts', 'renamed', 4, 3, {
        origin: { filename: 'old.ts', similarity: 77, identical: false },
      }),
    ]);
  });

  it('handles a rename whose paths share a directory prefix', () => {
    // The line format writes this as `src/{a => b}/x.ts`. Git scores it 100
    // with a line in and a line out, as it does lines reordered: not identical.
    expect(
      parseChangedFiles(
        numstatZ('1\t1\t', 'src/a/x.ts', 'src/b/x.ts'),
        nameStatusZ('R100', 'src/a/x.ts', 'src/b/x.ts'),
      ),
    ).toEqual([
      file('src/b/x.ts', 'renamed', 1, 1, {
        origin: { filename: 'src/a/x.ts', similarity: 100, identical: false },
      }),
    ]);
  });

  it('does not call a file identical when numstat never counted it', () => {
    const [copy] = parseChangedFiles(numstatZ(), nameStatusZ('C100', 'src/x.ts', 'src/y.ts'));
    expect(copy?.origin?.identical).toBe(false);
  });

  it('reports a copy under the new name', () => {
    expect(
      parseChangedFiles(
        numstatZ('0\t0\t', 'src/x.ts', 'src/y.ts'),
        nameStatusZ('C100', 'src/x.ts', 'src/y.ts'),
      ),
    ).toEqual([
      file('src/y.ts', 'copied', 0, 0, {
        origin: { filename: 'src/x.ts', similarity: 100, identical: true },
      }),
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
      file('new.ts', 'renamed', 2, 2, {
        origin: { filename: 'old.ts', similarity: 90, identical: false },
      }),
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
  const origins = ['--find-copies', '--find-copies-harder', '-l0'];

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
    args.includes(kind) && args.includes('--find-copies=1%');
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
    // Renames and copies are asked for explicitly: a repository's own
    // `diff.renames` could otherwise turn them off here while the patch still
    // pairs them. With nothing removed there is nothing to pair, so the
    // history is not read.
    expect(calls).toEqual([
      ['--literal-pathspecs', 'diff', '--numstat', '-z', ...origins, ...pins, 'base..head'],
      ['--literal-pathspecs', 'diff', '--name-status', '-z', ...origins, ...pins, 'base..head'],
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
      file('new.ts', 'renamed', 7, 5, {
        origin: { filename: 'old.ts', similarity: 31, identical: false },
      }),
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
      ...origins,
      ...pins,
      '--find-copies=1%',
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

describe('pairFiles', () => {
  const pairGit =
    (answers: Record<string, [string, string]>): GitRunner =>
    async ({ args }) => {
      const to = args.at(-1)!;
      const [numstat, status] = answers[to] ?? ['', ''];
      return { stdout: args.includes('--numstat') ? numstat : status, stderr: '', exitCode: 0 };
    };

  it('lists a copy beside its source, and a rename in place of the file it removed', async () => {
    const git = pairGit({
      'copy.ts': [
        numstatZ('1	1	tpl.ts', '3	2	', 'tpl.ts', 'copy.ts'),
        nameStatusZ('M', 'tpl.ts', 'C024', 'tpl.ts', 'copy.ts'),
      ],
      'moved.ts': [
        numstatZ('4	6	', 'gone.ts', 'moved.ts'),
        nameStatusZ('R012', 'gone.ts', 'moved.ts'),
      ],
    });
    const files = [
      file('tpl.ts', 'modified', 1, 1),
      file('gone.ts', 'removed', 0, 9),
      file('copy.ts', 'added', 20, 0),
      file('moved.ts', 'added', 12, 0),
    ];
    const paired = await pairFiles(git, '/work', 'base', 'head', files, [
      { from: 'tpl.ts', to: 'copy.ts' },
      { from: 'gone.ts', to: 'moved.ts' },
    ]);
    expect(paired).toEqual({
      files: [
        file('tpl.ts', 'modified', 1, 1),
        file('copy.ts', 'copied', 3, 2, {
          origin: { filename: 'tpl.ts', similarity: 24, identical: false },
        }),
        file('moved.ts', 'renamed', 4, 6, {
          origin: { filename: 'gone.ts', similarity: 12, identical: false },
        }),
      ],
      unpaired: [],
    });
  });

  it('hands back a pair git will not match even at 1%', async () => {
    const git = pairGit({
      'new.ts': [numstatZ('5	0	new.ts'), nameStatusZ('A', 'new.ts')],
    });
    const files = [file('new.ts', 'added', 5, 0)];
    await expect(
      pairFiles(git, '/work', 'base', 'head', files, [{ from: 'tpl.ts', to: 'new.ts' }]),
    ).resolves.toEqual({ files, unpaired: [{ from: 'tpl.ts', to: 'new.ts' }] });
  });

  it('refuses to make one removed file the origin of two renames', async () => {
    const git = pairGit({
      'a.ts': [numstatZ('1	1	', 'gone.ts', 'a.ts'), nameStatusZ('R050', 'gone.ts', 'a.ts')],
      'b.ts': [numstatZ('1	1	', 'gone.ts', 'b.ts'), nameStatusZ('R040', 'gone.ts', 'b.ts')],
    });
    await expect(
      pairFiles(
        git,
        '/work',
        'base',
        'head',
        [],
        [
          { from: 'gone.ts', to: 'a.ts' },
          { from: 'gone.ts', to: 'b.ts' },
        ],
      ),
    ).rejects.toThrow('two files were paired as renames of gone.ts');
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
