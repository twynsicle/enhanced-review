import { describe, expect, it } from 'vitest';

import { mergeFileLists } from './diff-files';

describe('mergeFileLists', () => {
  it('joins numstat additions/deletions with name-status', () => {
    const numstat = ['10\t5\tsrc/a.ts', '3\t0\tsrc/new.ts', '0\t8\told.ts'].join('\n');
    const nameStatus = ['M\tsrc/a.ts', 'A\tsrc/new.ts', 'D\told.ts'].join('\n');
    expect(mergeFileLists(numstat, nameStatus)).toEqual([
      { filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 5 },
      { filename: 'src/new.ts', status: 'added', additions: 3, deletions: 0 },
      { filename: 'old.ts', status: 'removed', additions: 0, deletions: 8 },
    ]);
  });

  it('treats binary files (numstat dashes) as zero counts', () => {
    expect(
      mergeFileLists('-\t-\timg.png', 'M\timg.png'),
    ).toEqual([{ filename: 'img.png', status: 'modified', additions: 0, deletions: 0 }]);
  });

  it('uses the new path when name-status reports a rename', () => {
    const numstat = '4\t2\tsrc/new.ts';
    const nameStatus = 'R100\tsrc/old.ts\tsrc/new.ts';
    expect(mergeFileLists(numstat, nameStatus)).toEqual([
      { filename: 'src/new.ts', status: 'renamed', additions: 4, deletions: 2 },
    ]);
  });

  it('falls back to modified for unknown status codes', () => {
    expect(mergeFileLists('1\t1\tx', 'X\tx')).toEqual([
      { filename: 'x', status: 'modified', additions: 1, deletions: 1 },
    ]);
  });

  it('handles empty input gracefully', () => {
    expect(mergeFileLists('', '')).toEqual([]);
  });
});
