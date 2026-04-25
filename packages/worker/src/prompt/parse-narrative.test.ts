import { describe, expect, it } from 'vitest';

import { buildDiffHunkIndex } from './diff-hunk-catalog';
import { parseNarrativeReview } from './parse-narrative';

const SAMPLE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,2 +12,5 @@',
  '-old',
  '+new',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -1,2 +1,3 @@',
  '-old',
  '+new',
].join('\n');

function wrap(json: object): string {
  return `<narrative_review>${JSON.stringify(json)}</narrative_review>`;
}

describe('parseNarrativeReview', () => {
  it('returns an error when tags are missing', () => {
    const result = parseNarrativeReview('no tags here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/tags/);
  });

  it('returns an error when inner JSON is invalid', () => {
    const result = parseNarrativeReview('<narrative_review>{not json}</narrative_review>');
    expect(result.ok).toBe(false);
  });

  it('rejects payloads missing required fields', () => {
    const result = parseNarrativeReview(wrap({ prTitle: 'x' }));
    expect(result.ok).toBe(false);
  });

  it('parses a minimal valid review', () => {
    const result = parseNarrativeReview(
      wrap({ prTitle: 'PR', overviewSummary: 'sum', chapters: [] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.chapters).toEqual([]);
  });

  it('synthesises missing chapter id/title and converts legacy summary to context insight', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'PR',
        overviewSummary: 'sum',
        chapters: [{ summary: 'legacy text' }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chapter = result.data.chapters[0]!;
    expect(chapter.id).toBe('chapter-1');
    expect(chapter.title).toBe('Chapter 1');
    expect(chapter.insights).toEqual([{ type: 'context', text: 'legacy text' }]);
  });

  it('resolves valid hunk IDs and drops chunks with no resolvable hunks', () => {
    const hunkIndex = buildDiffHunkIndex(SAMPLE_DIFF);
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'PR',
        overviewSummary: 'sum',
        chapters: [
          {
            id: 'c1',
            title: 'first',
            insights: [{ type: 'highlight', text: 'x' }],
            diffChunks: [
              { filename: 'src/a.ts', language: 'ts', hunkIds: ['H0001'] },
              { filename: 'src/b.ts', language: 'ts', hunkIds: ['H0099'] },
            ],
          },
        ],
      }),
      hunkIndex,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const chunks = result.data.chapters[0]!.diffChunks;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.filename).toBe('src/a.ts');
    expect(chunks[0]!.hunks[0]!.original).toEqual({ startLine: 10, lineCount: 2 });
  });

  it('drops hunk IDs that mismatch the chunk filename', () => {
    const hunkIndex = buildDiffHunkIndex(SAMPLE_DIFF);
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'PR',
        overviewSummary: 'sum',
        chapters: [
          {
            id: 'c1',
            title: 't',
            insights: [],
            diffChunks: [
              { filename: 'src/a.ts', language: 'ts', hunkIds: ['H0002'] },
            ],
          },
        ],
      }),
      hunkIndex,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.chapters[0]!.diffChunks).toHaveLength(0);
  });
});
