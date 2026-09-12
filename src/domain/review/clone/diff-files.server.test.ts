import { describe, expect, it } from 'vitest';
import {
  listChangedFileDetails,
  parseChangedFiles,
  type ChangedFile,
} from './diff-files.server.ts';
import type { GitRunner } from './git-runner.server.ts';
import type { ReviewFileStatus } from '../narrative.ts';

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
    previousFilename: null,
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

  it('keeps the counts and the old path of a rename that also changed lines', () => {
    // `-z` splits a rename into an empty third numstat field plus two paths;
    // the old line format collapsed it to `old.ts => new.ts` and never joined.
    expect(
      parseChangedFiles(
        numstatZ('4\t3\t', 'old.ts', 'new.ts'),
        nameStatusZ('R077', 'old.ts', 'new.ts'),
      ),
    ).toEqual([file('new.ts', 'renamed', 4, 3, { previousFilename: 'old.ts' })]);
  });

  it('handles a rename whose paths share a directory prefix', () => {
    // The line format writes this as `src/{a => b}/x.ts`.
    expect(
      parseChangedFiles(
        numstatZ('1\t1\t', 'src/a/x.ts', 'src/b/x.ts'),
        nameStatusZ('R100', 'src/a/x.ts', 'src/b/x.ts'),
      ),
    ).toEqual([file('src/b/x.ts', 'renamed', 1, 1, { previousFilename: 'src/a/x.ts' })]);
  });

  it('reports a copy under the new name', () => {
    expect(
      parseChangedFiles(
        numstatZ('0\t0\t', 'src/x.ts', 'src/y.ts'),
        nameStatusZ('C100', 'src/x.ts', 'src/y.ts'),
      ),
    ).toEqual([file('src/y.ts', 'copied', 0, 0, { previousFilename: 'src/x.ts' })]);
  });

  it('keeps ordinary entries straight when a rename sits between them', () => {
    expect(
      parseChangedFiles(
        numstatZ('1\t0\tsrc/a.ts', '2\t2\t', 'old.ts', 'new.ts', '0\t3\tsrc/c.ts'),
        nameStatusZ('M', 'src/a.ts', 'R090', 'old.ts', 'new.ts', 'M', 'src/c.ts'),
      ),
    ).toEqual([
      file('src/a.ts', 'modified', 1, 0),
      file('new.ts', 'renamed', 2, 2, { previousFilename: 'old.ts' }),
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

  it('ignores empty and malformed records', () => {
    expect(parseChangedFiles('', '')).toEqual([]);
    expect(parseChangedFiles(numstatZ('not-a-numstat'), nameStatusZ('M'))).toEqual([]);
  });
});

describe('listChangedFileDetails', () => {
  it('runs numstat and name-status against the range and merges them', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (opts) => {
      calls.push([...opts.args]);
      const stdout = opts.args.includes('--numstat')
        ? numstatZ('3\t1\tf.txt')
        : nameStatusZ('M', 'f.txt');
      return { stdout, stderr: '', exitCode: 0 };
    };
    await expect(listChangedFileDetails(git, '/work', 'base', 'head')).resolves.toEqual([
      file('f.txt', 'modified', 3, 1),
    ]);
    expect(calls).toEqual([
      ['diff', '--numstat', '-z', 'base..head'],
      ['diff', '--name-status', '-z', 'base..head'],
    ]);
  });
});
