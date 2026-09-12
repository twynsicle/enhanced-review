import { describe, expect, it } from 'vitest';
import { buildDiffHunkIndex } from './diff-hunk-catalog.ts';
import { escapeStrayQuotes, parseNarrativeReview } from './parse-narrative.ts';

function wrap(payload: unknown): string {
  return `Sure, here you go:\n<narrative_review>${JSON.stringify(payload)}</narrative_review>\nDone.`;
}

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

describe('parseNarrativeReview', () => {
  it('sanitizes the risk assessment fields', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'Risk test',
        overviewSummary: 'Summary',
        riskAssessment: {
          score: 4,
          summary: 'High risk because data can be affected.',
          rationale: 'The change touches persistence and lacks visible rollback detail.',
          factors: [
            { name: 'Data safety', impact: 'raises', detail: 'Persistence behavior changed.' },
            {
              name: 'Unknown',
              impact: 'unexpected',
              detail: 'Unexpected impact values fall back to neutral.',
            },
            { name: 'no detail' },
          ],
        },
        chapters: [],
      }),
    );

    expect(result).toEqual({
      ok: true,
      data: {
        prTitle: 'Risk test',
        overviewSummary: 'Summary',
        riskAssessment: {
          score: 4,
          summary: 'High risk because data can be affected.',
          rationale: 'The change touches persistence and lacks visible rollback detail.',
          factors: [
            { name: 'Data safety', impact: 'raises', detail: 'Persistence behavior changed.' },
            {
              name: 'Unknown',
              impact: 'neutral',
              detail: 'Unexpected impact values fall back to neutral.',
            },
          ],
        },
        chapters: [],
      },
    });
  });

  it('omits invalid risk assessments for backwards compatibility', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'Old review',
        overviewSummary: 'Summary',
        riskAssessment: { score: 9 },
        chapters: [],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.riskAssessment).toBeUndefined();
  });

  it('rounds a fractional score and synthesises a summary', () => {
    const result = parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: 's', riskAssessment: { score: 2.6 }, chapters: [] }),
    );
    expect(result.ok && result.data.riskAssessment).toEqual({
      score: 3,
      summary: 'Risk score 3 of 5.',
      rationale: '',
      factors: [],
    });
  });

  it('fills chapter ids, titles and descriptions, and coerces insights', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: 's',
        chapters: [
          {
            summary: 'legacy summary field',
            insights: [
              { type: 'highlight', title: '  Headline  ', text: 'body' },
              { type: 'bogus', text: 'falls back to context' },
              { type: 'context' },
              'not an insight',
            ],
          },
        ],
      }),
    );
    expect(result.ok && result.data.chapters).toEqual([
      {
        id: 'chapter-1',
        title: 'Chapter 1',
        description: 'legacy summary field',
        insights: [
          { type: 'highlight', title: 'Headline', text: 'body' },
          { type: 'context', text: 'falls back to context' },
        ],
        diffChunks: [],
      },
    ]);
  });

  it('resolves hunk ids against the index, dropping unknown and wrong-file ids', () => {
    const hunkIndex = buildDiffHunkIndex(DIFF);
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: 's',
        chapters: [
          {
            id: 'c1',
            title: 'C1',
            description: '',
            insights: [],
            diffChunks: [
              {
                filename: 'src/a.ts',
                language: 'typescript',
                hunkIds: ['H0002', 'H0001', 'H0002', 'H0003', 'H9999'],
              },
              { filename: 'src/b.ts', hunkIds: ['H0001'] },
              { filename: 'src/b.ts', language: 'typescript', hunkIds: ['H0003'] },
              { hunkIds: ['H0003'] },
            ],
          },
        ],
      }),
      hunkIndex,
    );
    expect(result.ok && result.data.chapters[0]?.diffChunks).toEqual([
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: [
          {
            id: 'H0001',
            fileOrder: 1,
            original: { startLine: 1, lineCount: 3 },
            modified: { startLine: 1, lineCount: 4 },
          },
          {
            id: 'H0002',
            fileOrder: 2,
            original: { startLine: 20, lineCount: 2 },
            modified: { startLine: 21, lineCount: 3 },
          },
        ],
      },
      {
        filename: 'src/b.ts',
        language: 'typescript',
        hunks: [
          {
            id: 'H0003',
            fileOrder: 1,
            original: { startLine: 5, lineCount: 1 },
            modified: { startLine: 5, lineCount: 1 },
          },
        ],
      },
    ]);
  });

  it('drops every diff chunk when no hunk index is supplied', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: 's',
        chapters: [{ id: 'c', title: 'C', diffChunks: [{ filename: 'a', hunkIds: ['H0001'] }] }],
      }),
    );
    expect(result.ok && result.data.chapters[0]?.diffChunks).toEqual([]);
  });

  it('strips unknown top-level keys so stored content matches the schema', () => {
    const result = parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: 's', chapters: [], extra: 'noise' }),
    );
    expect(result.ok && result.data).not.toHaveProperty('extra');
  });

  it('rejects missing tags, malformed JSON and missing required fields', () => {
    expect(parseNarrativeReview('no tags here')).toEqual({
      ok: false,
      error: 'Response did not contain expected <narrative_review> tags',
    });
    expect(parseNarrativeReview('<narrative_review>{oops</narrative_review>')).toEqual({
      ok: false,
      error: 'Failed to parse narrative review JSON from response',
    });
    expect(parseNarrativeReview(wrap({ prTitle: 'x' }))).toEqual({
      ok: false,
      error: 'Narrative review JSON is missing required fields',
    });
  });

  it('ignores a closing tag mentioned in the preamble before the real block', () => {
    const text = `I will end the block with </narrative_review> when I am done.\n${wrap({
      prTitle: 't',
      overviewSummary: 's',
      chapters: [],
    })}`;
    const result = parseNarrativeReview(text);
    expect(result.ok && result.data.prTitle).toBe('t');
  });

  it('carries an overview diagram and a chapter diagram through', () => {
    const diagram = {
      kind: 'architecture',
      title: 'Shape',
      caption: 'Where the new limb attaches.',
      nodes: [
        { id: 'a', label: 'A', filename: 'src/a.ts', hunkIds: ['H0001'], change: 'modified' },
        { id: 'b', label: 'B', change: 'added' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'calls' }],
    };
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'Diagrams',
        overviewSummary: 'Summary',
        overviewDiagram: diagram,
        chapters: [{ id: 'one', title: 'One', insights: [], diffChunks: [], diagram }],
      }),
      buildDiffHunkIndex(DIFF),
    );

    expect(result.ok && result.data.overviewDiagram?.id).toBe('overview-diagram');
    expect(result.ok && result.data.chapters[0]?.diagram?.id).toBe('one-diagram');
  });

  it('drops a malformed diagram without failing the review', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'Diagrams',
        overviewSummary: 'Summary',
        // No caption: the diagram goes, the review stays.
        overviewDiagram: { kind: 'architecture', title: 'Shape', nodes: [], edges: [] },
        chapters: [{ id: 'one', title: 'One', insights: [], diffChunks: [] }],
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.overviewDiagram).toBeUndefined();
    expect(result.ok && result.data.chapters).toHaveLength(1);
  });
});

/** One double quote, built rather than escaped, so it survives any tooling. */
const DQ = String.fromCharCode(34);

describe('a quote the model forgot to escape', () => {
  // What a real review sent, and what it used to cost: one unescaped pair
  // inside a 37 KB answer, and the whole run thrown away.
  const STRAY = `{ "prTitle": "T", "overviewSummary": "a ${DQ}no hunks${DQ} message", "chapters": [] }`;

  it('is escaped, so the review survives', () => {
    const result = parseNarrativeReview(`<narrative_review>${STRAY}</narrative_review>`);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.overviewSummary).toBe(`a ${DQ}no hunks${DQ} message`);
  });

  it('leaves valid JSON exactly as it was', () => {
    const valid = JSON.stringify({
      prTitle: 'T',
      overviewSummary: `escaped ${DQ}quotes${DQ}, a brace } and a comma, inside`,
      chapters: [{ id: 'a', title: 'A', insights: [], diffChunks: [] }],
    });

    expect(escapeStrayQuotes(valid)).toBe(valid);
  });

  it('still fails cleanly on what it cannot repair', () => {
    // A stray quote directly before a comma reads as the end of the string.
    const beyond = `{ "prTitle": "T", "overviewSummary": "he said ${DQ}hi${DQ}, then left", "chapters": [] }`;
    const result = parseNarrativeReview(`<narrative_review>${beyond}</narrative_review>`);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('Failed to parse');
  });
});
