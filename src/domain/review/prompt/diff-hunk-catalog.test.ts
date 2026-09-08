import { describe, expect, it } from 'vitest';
import { buildDiffHunkIndex } from './diff-hunk-catalog.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 a
+b
@@ -10 +11,2 @@ function x() {
-c
+d
+e
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1,2 @@
+x
+y
`;

describe('buildDiffHunkIndex', () => {
  it('numbers hunks globally and per file, with line spans from the header', () => {
    const index = buildDiffHunkIndex(DIFF);
    expect(index.hunks.map((h) => [h.id, h.filename, h.fileOrder])).toEqual([
      ['H0001', 'src/a.ts', 1],
      ['H0002', 'src/a.ts', 2],
      ['H0003', 'src/b.ts', 1],
    ]);
    expect(index.byId['H0001']).toMatchObject({
      original: { startLine: 1, lineCount: 3 },
      modified: { startLine: 1, lineCount: 4 },
      header: '@@ -1,3 +1,4 @@',
    });
    // A missing count means one line; a zero count is kept as zero.
    expect(index.byId['H0002']).toMatchObject({
      original: { startLine: 10, lineCount: 1 },
      modified: { startLine: 11, lineCount: 2 },
    });
    expect(index.byId['H0003']).toMatchObject({
      original: { startLine: 1, lineCount: 0 },
      modified: { startLine: 1, lineCount: 2 },
    });
  });

  it('ignores hunk headers that appear before any file header', () => {
    expect(buildDiffHunkIndex('@@ -1 +1 @@\n+x\n').hunks).toEqual([]);
  });

  it('returns an empty index for an empty diff', () => {
    expect(buildDiffHunkIndex('')).toEqual({ hunks: [], byId: {} });
  });
});
