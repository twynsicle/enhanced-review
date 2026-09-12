import { describe, expect, it } from 'vitest';
import { listChangedFiles, mergeFileLists, parseChangedFiles } from './diff-files.server.ts';
import type { GitRunner } from './git-runner.server.ts';

/** `git diff --numstat -z` output: every field is NUL-terminated. */
function numstatZ(...fields: string[]): string {
  return fields.map((f) => `${f}\0`).join('');
}
const nameStatusZ = numstatZ;

describe('mergeFileLists', () => {
  it('joins counts and statuses on the filename', () => {
    expect(
      mergeFileLists(
        numstatZ('10\t2\tsrc/a.ts', '0\t5\tsrc/b.ts'),
        nameStatusZ('M', 'src/a.ts', 'D', 'src/b.ts'),
      ),
    ).toEqual([
      { filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 2 },
      { filename: 'src/b.ts', status: 'removed', additions: 0, deletions: 5 },
    ]);
  });

  it('keeps the counts of a rename that also changed lines', () => {
    // `-z` splits a rename into an empty third numstat field plus two paths;
    // the old line format collapsed it to `old.ts => new.ts` and never joined.
    expect(
      mergeFileLists(
        numstatZ('4\t3\t', 'old.ts', 'new.ts'),
        nameStatusZ('R077', 'old.ts', 'new.ts'),
      ),
    ).toEqual([{ filename: 'new.ts', status: 'renamed', additions: 4, deletions: 3 }]);
  });

  it('handles a rename whose paths share a directory prefix', () => {
    // The line format writes this as `src/{a => b}/x.ts`.
    expect(
      mergeFileLists(
        numstatZ('1\t1\t', 'src/a/x.ts', 'src/b/x.ts'),
        nameStatusZ('R100', 'src/a/x.ts', 'src/b/x.ts'),
      ),
    ).toEqual([{ filename: 'src/b/x.ts', status: 'renamed', additions: 1, deletions: 1 }]);
  });

  it('reports a copy under the new name', () => {
    expect(
      mergeFileLists(
        numstatZ('0\t0\t', 'src/x.ts', 'src/y.ts'),
        nameStatusZ('C100', 'src/x.ts', 'src/y.ts'),
      ),
    ).toEqual([{ filename: 'src/y.ts', status: 'copied', additions: 0, deletions: 0 }]);
  });

  it('keeps ordinary entries straight when a rename sits between them', () => {
    expect(
      mergeFileLists(
        numstatZ('1\t0\tsrc/a.ts', '2\t2\t', 'old.ts', 'new.ts', '0\t3\tsrc/c.ts'),
        nameStatusZ('M', 'src/a.ts', 'R090', 'old.ts', 'new.ts', 'M', 'src/c.ts'),
      ),
    ).toEqual([
      { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 },
      { filename: 'new.ts', status: 'renamed', additions: 2, deletions: 2 },
      { filename: 'src/c.ts', status: 'modified', additions: 0, deletions: 3 },
    ]);
  });

  it('treats binary "-" counts as zero and unknown codes as modified', () => {
    expect(
      mergeFileLists(numstatZ('-\t-\tlogo.png'), nameStatusZ('A', 'logo.png', 'X', 'weird')),
    ).toEqual([
      { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
      { filename: 'weird', status: 'modified', additions: 0, deletions: 0 },
    ]);
  });

  it('carries paths with spaces and non-ASCII bytes through unquoted', () => {
    expect(
      mergeFileLists(
        numstatZ('1\t0\tdocs/notes für mich.md'),
        nameStatusZ('A', 'docs/notes für mich.md'),
      ),
    ).toEqual([
      { filename: 'docs/notes für mich.md', status: 'added', additions: 1, deletions: 0 },
    ]);
  });

  it('ignores empty and malformed records', () => {
    expect(mergeFileLists('', '')).toEqual([]);
    expect(mergeFileLists(numstatZ('not-a-numstat'), nameStatusZ('M'))).toEqual([]);
  });
});

describe('parseChangedFiles', () => {
  it("keeps a rename's old path and marks binary files", () => {
    expect(
      parseChangedFiles(
        numstatZ('4	3	', 'old.ts', 'new.ts', '-	-	logo.png', '0	0	empty.txt'),
        nameStatusZ('R077', 'old.ts', 'new.ts', 'A', 'logo.png', 'A', 'empty.txt'),
      ),
    ).toEqual([
      {
        filename: 'new.ts',
        status: 'renamed',
        additions: 4,
        deletions: 3,
        previousFilename: 'old.ts',
        binary: false,
      },
      {
        filename: 'logo.png',
        status: 'added',
        additions: 0,
        deletions: 0,
        previousFilename: null,
        binary: true,
      },
      {
        filename: 'empty.txt',
        status: 'added',
        additions: 0,
        deletions: 0,
        previousFilename: null,
        binary: false,
      },
    ]);
  });
});

describe('listChangedFiles', () => {
  it('runs numstat and name-status against the range and merges them', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (opts) => {
      calls.push([...opts.args]);
      const stdout = opts.args.includes('--numstat')
        ? numstatZ('3\t1\tf.txt')
        : nameStatusZ('M', 'f.txt');
      return { stdout, stderr: '', exitCode: 0 };
    };
    await expect(listChangedFiles(git, '/work', 'base', 'head')).resolves.toEqual([
      { filename: 'f.txt', status: 'modified', additions: 3, deletions: 1 },
    ]);
    expect(calls).toEqual([
      ['diff', '--numstat', '-z', 'base..head'],
      ['diff', '--name-status', '-z', 'base..head'],
    ]);
  });
});
