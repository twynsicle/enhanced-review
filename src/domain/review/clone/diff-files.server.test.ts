import { describe, expect, it } from 'vitest';
import { listChangedFiles, mergeFileLists } from './diff-files.server.ts';
import type { GitRunner } from './git-runner.server.ts';

describe('mergeFileLists', () => {
  it('joins counts and statuses on the filename', () => {
    const numstat = '10\t2\tsrc/a.ts\n0\t5\tsrc/b.ts\n';
    const nameStatus = 'M\tsrc/a.ts\nD\tsrc/b.ts\n';
    expect(mergeFileLists(numstat, nameStatus)).toEqual([
      { filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 2 },
      { filename: 'src/b.ts', status: 'removed', additions: 0, deletions: 5 },
    ]);
  });

  it('reports renames and copies under the new name', () => {
    const numstat = '1\t1\told.ts => new.ts\n';
    const nameStatus = 'R095\told.ts\tnew.ts\nC100\tsrc/x.ts\tsrc/y.ts\n';
    const files = mergeFileLists(numstat, nameStatus);
    expect(files.map((f) => [f.filename, f.status])).toEqual([
      ['new.ts', 'renamed'],
      ['src/y.ts', 'copied'],
    ]);
  });

  it('treats binary "-" counts as zero and unknown codes as modified', () => {
    expect(mergeFileLists('-\t-\tlogo.png\n', 'A\tlogo.png\nX\tweird\n')).toEqual([
      { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 },
      { filename: 'weird', status: 'modified', additions: 0, deletions: 0 },
    ]);
  });

  it('ignores blank and malformed lines', () => {
    expect(mergeFileLists('\nnot-a-numstat\n', '\n')).toEqual([]);
  });
});

describe('listChangedFiles', () => {
  it('runs numstat and name-status against the range and merges them', async () => {
    const calls: string[][] = [];
    const git: GitRunner = async (opts) => {
      calls.push([...opts.args]);
      const stdout = opts.args.includes('--numstat') ? '3\t1\tf.txt\n' : 'M\tf.txt\n';
      return { stdout, stderr: '', exitCode: 0 };
    };
    await expect(listChangedFiles(git, '/work', 'base', 'head')).resolves.toEqual([
      { filename: 'f.txt', status: 'modified', additions: 3, deletions: 1 },
    ]);
    expect(calls).toEqual([
      ['diff', '--numstat', 'base..head'],
      ['diff', '--name-status', 'base..head'],
    ]);
  });
});
