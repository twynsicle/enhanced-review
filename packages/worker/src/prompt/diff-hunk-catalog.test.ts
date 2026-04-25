import { describe, expect, it } from 'vitest';

import { buildDiffHunkIndex } from './diff-hunk-catalog';

describe('buildDiffHunkIndex', () => {
  it('extracts hunks with stable IDs, per-file order, and spans on both sides', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,2 +12,5 @@',
      '-old',
      '+new',
      '@@ -40 +50 @@',
      '-x',
      '+y',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -2,3 +2,0 @@',
      '-gone',
    ].join('\n');

    const index = buildDiffHunkIndex(diff);
    expect(index.hunks).toEqual([
      {
        id: 'H0001',
        filename: 'src/a.ts',
        header: '@@ -10,2 +12,5 @@',
        fileOrder: 1,
        original: { startLine: 10, lineCount: 2 },
        modified: { startLine: 12, lineCount: 5 },
      },
      {
        id: 'H0002',
        filename: 'src/a.ts',
        header: '@@ -40 +50 @@',
        fileOrder: 2,
        original: { startLine: 40, lineCount: 1 },
        modified: { startLine: 50, lineCount: 1 },
      },
      {
        id: 'H0003',
        filename: 'src/b.ts',
        header: '@@ -2,3 +2,0 @@',
        fileOrder: 1,
        original: { startLine: 2, lineCount: 3 },
        modified: { startLine: 2, lineCount: 0 },
      },
    ]);

    expect(index.byId['H0002']?.filename).toBe('src/a.ts');
    expect(index.byId['H0003']?.modified).toEqual({ startLine: 2, lineCount: 0 });
  });

  it('preserves zero-length insertion spans without faking a line range', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -7,0 +9,4 @@',
      '+new',
    ].join('\n');

    const index = buildDiffHunkIndex(diff);
    expect(index.hunks).toEqual([
      {
        id: 'H0001',
        filename: 'src/a.ts',
        header: '@@ -7,0 +9,4 @@',
        fileOrder: 1,
        original: { startLine: 7, lineCount: 0 },
        modified: { startLine: 9, lineCount: 4 },
      },
    ]);
  });

  it('ignores hunks before file headers', () => {
    const diff = '@@ -1 +1 @@\n-old\n+new';
    const index = buildDiffHunkIndex(diff);
    expect(index.hunks).toEqual([]);
  });
});
