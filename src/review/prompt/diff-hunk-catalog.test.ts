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
diff --git a/src/c.ts b/src/c.ts
--- a/src/c.ts
+++ b/src/c.ts
@@ -1,0 +2,2 @@
+p
+q
`;

describe('buildDiffHunkIndex', () => {
  it('numbers hunks globally and per file, with line spans from the header', () => {
    const index = buildDiffHunkIndex(DIFF);
    expect(index.hunks.map((h) => [h.id, h.filename, h.fileOrder])).toEqual([
      ['H0001', 'src/a.ts', 1],
      ['H0002', 'src/a.ts', 2],
      ['H0003', 'src/b.ts', 1],
      ['H0004', 'src/c.ts', 1],
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
      original: { startLine: 0, lineCount: 0 },
      modified: { startLine: 1, lineCount: 2 },
    });
  });

  it('keeps an insertion above the first line apart from one below it', () => {
    // `-0,0` and `-1,0` are different positions. Clamping both to line 1
    // makes the original side of a diff that starts at line 1 carry one line
    // of trailing context the modified side does not, and Monaco re-diffs the
    // surplus into a deletion at the bottom of the snippet.
    const index = buildDiffHunkIndex(DIFF);
    expect(index.byId['H0003']?.original).toEqual({ startLine: 0, lineCount: 0 });
    expect(index.byId['H0004']?.original).toEqual({ startLine: 1, lineCount: 0 });
  });

  it('floors a malformed zero-length header at 0 and any other at line 1', () => {
    const index = buildDiffHunkIndex('diff --git a/x.ts b/x.ts\n@@ -0,0 +0,0 @@\n@@ -0 +0 @@\n');
    expect(index.byId['H0001']?.original).toEqual({ startLine: 0, lineCount: 0 });
    // A side that covers lines has no line 0 to sit on.
    expect(index.byId['H0002']?.original).toEqual({ startLine: 1, lineCount: 1 });
  });

  it('ignores hunk headers that appear before any file header', () => {
    expect(buildDiffHunkIndex('@@ -1 +1 @@\n+x\n').hunks).toEqual([]);
  });

  it('returns an empty index for an empty diff', () => {
    expect(buildDiffHunkIndex('')).toEqual({ hunks: [], byId: {} });
  });
});
