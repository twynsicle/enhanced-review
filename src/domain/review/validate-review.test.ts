import { describe, expect, it } from 'vitest';
import { buildDiffHunkIndex, groundingFor, type DiffHunk } from './prompt/diff-hunk-catalog.ts';
import { validateReview } from './validate-review.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
+x
@@ -20,2 +21,3 @@
+y
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -5,1 +5,1 @@
-z
+w
`;

const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);

function review(chunks: { filename: string; hunkIds: string[] }[]): string {
  return `<narrative_review>${JSON.stringify({
    prTitle: 't',
    overviewSummary: { lede: 's' },
    chapters: [
      {
        id: 'c',
        title: 'C',
        insights: [],
        diffChunks: chunks.map((chunk) => ({ ...chunk, language: 'typescript' })),
      },
    ],
  })}</narrative_review>`;
}

const ALL = [
  { filename: 'src/a.ts', hunkIds: ['H0001', 'H0002'] },
  { filename: 'src/b.ts', hunkIds: ['H0003'] },
];

describe('validateReview', () => {
  it('returns the review and nothing to report when every shown hunk is cited', () => {
    const result = validateReview(review(ALL), grounding);
    expect(result.review?.prTitle).toBe('t');
    expect(result.findings).toEqual([]);
  });

  it('disqualifies a review that leaves hunks uncited, listing them by file', () => {
    const result = validateReview(
      review([{ filename: 'src/a.ts', hunkIds: ['H0001'] }]),
      grounding,
    );
    expect(result.review).not.toBeNull();
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'hunk-uncited',
        severity: 'fatal',
        hunkIds: ['H0002', 'H0003'],
      }),
    ]);
    expect(result.findings[0]?.message).toBe(
      '2 hunks are cited by no chapter: H0002 (src/a.ts); H0003 (src/b.ts).',
    );
  });

  it('counts the uncited hunks it does not have room to name', () => {
    const hunks: DiffHunk[] = Array.from({ length: 25 }, (_, i) => ({
      id: `H${String(i + 1).padStart(4, '0')}`,
      filename: 'src/a.ts',
      header: '@@',
      fileOrder: i + 1,
      original: { startLine: i + 1, lineCount: 1 },
      modified: { startLine: i + 1, lineCount: 1 },
    }));
    const result = validateReview(review([{ filename: 'src/a.ts', hunkIds: ['H0001'] }]), {
      shown: { hunks, byId: Object.fromEntries(hunks.map((h) => [h.id, h])) },
      filenames: new Set(['src/a.ts']),
    });
    // The count leads: the job error column clips at 500 characters, and the
    // tail is the first thing real paths push off the end.
    expect(result.findings[0]?.message).toMatch(/^24 hunks are cited by no chapter: /);
    expect(result.findings[0]?.message).toContain('; and 16 more.');
    expect(result.findings[0]?.hunkIds).toHaveLength(24);
  });

  it('carries the parse findings through beside its own', () => {
    const result = validateReview(
      review([{ filename: 'src/a.ts', hunkIds: ['H0001', 'H0002', 'H9999'] }]),
      grounding,
    );
    expect(result.findings.map((f) => f.code)).toEqual(['hunk-id-dropped', 'hunk-uncited']);
    expect(result.findings[1]?.message).toBe('1 hunk is cited by no chapter: H0003 (src/b.ts).');
  });

  it('reports no review and the parse failure when the answer cannot be read', () => {
    const result = validateReview('nothing to see', grounding);
    expect(result.review).toBeNull();
    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'answer-missing-block', severity: 'fatal' }),
    ]);
  });

  it('asks nothing of a review that was shown no hunks to cite', () => {
    const text = `<narrative_review>${JSON.stringify({
      prTitle: 't',
      overviewSummary: { lede: 's' },
      chapters: [{ id: 'c', title: 'C', insights: [], diffChunks: [] }],
    })}</narrative_review>`;
    expect(validateReview(text, groundingFor([])).findings).toEqual([]);
    expect(validateReview(text).findings).toEqual([]);
  });
});
