import { describe, expect, it } from 'vitest';
import { fatalFindings } from '../findings.ts';
import type { OverviewStyles } from '../narrative.ts';
import { buildDiffHunkIndex, groundingFor } from './diff-hunk-catalog.ts';
import { escapeStrayQuotes, parseNarrativeReview, type ParseResult } from './parse-narrative.ts';

type Payload = Record<string, unknown>;

/**
 * The payload as a model following the prompt sends it, so that a test about
 * something else is not also a test of a missing field: every chapter given a
 * headline, and a reading plan of the first chapter for the brief and every
 * chapter for the standard read. A chapter that names `headline`, and a
 * payload that names `readingPlan`, even as undefined, keep their own.
 */
function asPrompted(payload: Payload): Payload {
  const chapters: unknown[] = Array.isArray(payload['chapters']) ? payload['chapters'] : [];
  const headlined = chapters.map((chapter) =>
    chapter !== null && typeof chapter === 'object' && !('headline' in chapter)
      ? { ...chapter, headline: 'What this chapter changes.' }
      : chapter,
  );
  const withHeadlines = 'chapters' in payload ? { ...payload, chapters: headlined } : payload;
  if ('readingPlan' in payload || chapters.length === 0) return withHeadlines;
  const ids = chapters.map((chapter, index) => {
    const id = (chapter as Payload | null)?.['id'];
    return typeof id === 'string' && id.length > 0 ? id : `chapter-${String(index + 1)}`;
  });
  return { ...withHeadlines, readingPlan: { brief: ids.slice(0, 1), standard: ids } };
}

function wrap(payload: Payload): string {
  return `Sure, here you go:\n<narrative_review>${JSON.stringify(asPrompted(payload))}</narrative_review>\nDone.`;
}

/** What a failed parse reports: its first fatal finding. Null when it parses. */
function firstFatal(result: ParseResult): string | null {
  return result.ok ? null : (fatalFindings(result.findings)[0]?.message ?? null);
}

function error(text: string): string | null {
  return firstFatal(parseNarrativeReview(text));
}

const codes = (result: ParseResult) => result.findings.map((f) => f.code);

/** Citations at the `read` tier, the shape a model that tiers everything conservatively sends. */
const read = (ids: string[]) => ids.map((id) => ({ id, tier: 'read' }));

const cite = (filename: string, hunkIds: string[]) => ({
  filename,
  language: 'typescript',
  hunks: read(hunkIds),
});

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
        overviewSummary: { lede: 'Summary' },
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

    expect(result.ok && result.data).toEqual({
      prTitle: 'Risk test',
      overviewStyles: ['narrative'],
      overviewSummary: { lede: 'Summary' },
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
    });
  });

  it('drops a risk assessment whose score is out of range, and keeps the review', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'Scoreless',
        overviewSummary: { lede: 'Summary' },
        riskAssessment: { score: 9 },
        chapters: [],
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.riskAssessment).toBeUndefined();
  });

  it('rounds a fractional score and synthesises a summary', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        riskAssessment: { score: 2.6 },
        chapters: [],
      }),
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
        overviewSummary: { lede: 's' },
        chapters: [
          {
            headline: 'No id and no title of its own.',
            insights: [
              { type: 'highlight', title: '  Headline  ', text: 'body' },
              { type: 'bogus', text: 'falls back to context' },
              { type: 'context' },
              'not an insight',
            ],
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: read(['H0001']) }],
          },
        ],
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );
    expect(result.ok && result.data.chapters).toEqual([
      {
        id: 'chapter-1',
        title: 'Chapter 1',
        headline: 'No id and no title of its own.',
        insights: [
          { type: 'highlight', title: 'Headline', text: 'body' },
          { type: 'context', text: 'falls back to context' },
        ],
        diffChunks: [
          {
            filename: 'src/a.ts',
            language: 'typescript',
            hunks: [
              {
                id: 'H0001',
                fileOrder: 1,
                original: { startLine: 1, lineCount: 3 },
                modified: { startLine: 1, lineCount: 4 },
                changedLines: 1,
                tier: 'read',
              },
            ],
          },
        ],
      },
    ]);
  });

  it('fails the review when a chapter ends up with no diffChunks', () => {
    const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          { id: 'empty', title: 'Empty', insights: [], diffChunks: [] },
          {
            id: 'real',
            title: 'Real',
            insights: [],
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: read(['H0001']) }],
          },
        ],
      }),
      grounding,
    );
    expect(result.ok).toBe(false);
    expect(firstFatal(result)).toBe(
      'Chapter "Empty" (empty) cites no hunk that resolved against the diff.',
    );
  });

  it('does not fail an empty chapter when the diff showed no hunks at all', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [{ id: 'nothing', title: 'Nothing to cite', insights: [], diffChunks: [] }],
      }),
      groundingFor([]),
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.chapters[0]?.diffChunks).toEqual([]);
  });

  it('resolves hunk ids against what the prompt showed, dropping unknown and wrong-file ids', () => {
    const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'c1',
            title: 'C1',
            insights: [],
            diffChunks: [
              {
                filename: 'src/a.ts',
                language: 'typescript',
                hunks: read(['H0002', 'H0001', 'H0002', 'H0003', 'H9999']),
              },
              { filename: 'src/b.ts', hunks: read(['H0001']) },
              { filename: 'src/b.ts', language: 'typescript', hunks: read(['H0003']) },
              { hunks: read(['H0003']) },
            ],
          },
        ],
      }),
      grounding,
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
            changedLines: 1,
            tier: 'read',
          },
          {
            id: 'H0002',
            fileOrder: 2,
            original: { startLine: 20, lineCount: 2 },
            modified: { startLine: 21, lineCount: 3 },
            changedLines: 1,
            tier: 'read',
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
            changedLines: 2,
            tier: 'read',
          },
        ],
      },
    ]);
  });

  it('drops every diff chunk when no hunk index is supplied', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          { id: 'c', title: 'C', diffChunks: [{ filename: 'a', hunks: read(['H0001']) }] },
        ],
      }),
    );
    expect(result.ok && result.data.chapters[0]?.diffChunks).toEqual([]);
  });

  it('strips unknown top-level keys so stored content matches the schema', () => {
    const result = parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: { lede: 's' }, chapters: [], extra: 'noise' }),
    );
    expect(result.ok && result.data).not.toHaveProperty('extra');
  });

  it('rejects missing tags, malformed JSON and missing required fields', () => {
    expect(error('no tags here')).toBe('The answer contains no complete <narrative_review> block.');
    expect(error('<narrative_review>{oops</narrative_review>')).toBe(
      'The <narrative_review> block is not valid JSON.',
    );
    expect(error(wrap({ prTitle: 'x' }))).toBe('The narrative review has no chapters array.');
    expect(error(wrap({ chapters: [] }))).toBe('The narrative review has no prTitle.');
  });

  it('ignores a closing tag mentioned in the preamble before the real block', () => {
    const text = `I will end the block with </narrative_review> when I am done.\n${wrap({
      prTitle: 't',
      overviewSummary: { lede: 's' },
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
        overviewSummary: { lede: 'Summary' },
        overviewDiagram: diagram,
        chapters: [
          {
            id: 'one',
            title: 'One',
            insights: [],
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: read(['H0001']) }],
            diagram,
          },
        ],
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );

    expect(result.ok && result.data.overviewDiagram?.id).toBe('overview-diagram');
    expect(result.ok && result.data.chapters[0]?.diagram?.id).toBe('one-diagram');
  });

  it('drops a malformed diagram without failing the review', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 'Diagrams',
        overviewSummary: { lede: 'Summary' },
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

const chapter = (fields: Payload) => ({
  prTitle: 't',
  overviewSummary: { lede: 'A lede.', bodies: { narrative: 'And a body.' } },
  chapters: [
    {
      id: 'c',
      title: 'C',
      ...fields,
      insights: [],
      diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: read(['H0001']) }],
    },
  ],
});

describe('prose', () => {
  const parse = (payload: Payload, styles: OverviewStyles = ['narrative']) =>
    parseNarrativeReview(
      wrap(payload),
      groundingFor(buildDiffHunkIndex(DIFF).hunks, undefined, undefined, styles),
    );

  it("keeps a chapter's headline and body apart, trimmed", () => {
    const result = parse(
      chapter({ headline: ' The headline. ', bodies: { narrative: '- a\n- b\n' } }),
    );
    expect(result.ok && result.data.chapters[0]).toMatchObject({
      headline: 'The headline.',
      bodies: { narrative: '- a\n- b' },
    });
    expect(result.ok && result.data.overviewSummary).toEqual({
      lede: 'A lede.',
      bodies: { narrative: 'And a body.' },
    });
    expect(result.ok && result.data.overviewStyles).toEqual(['narrative']);
  });

  it('leaves out a body with nothing in it, noting one that arrived unreadable', () => {
    for (const body of ['   ', 7, ['- a list'], undefined]) {
      const result = parse(chapter({ headline: 'The headline.', bodies: { narrative: body } }));
      expect(result.ok && result.data.chapters[0]?.bodies).toBeUndefined();
      expect(codes(result).includes('prose-dropped')).toBe(body !== undefined);
    }
    for (const bodies of ['a string, with two styles asked for', ['a list']]) {
      const result = parse(chapter({ headline: 'The headline.', bodies }), ['plain', 'simple']);
      expect(result.ok && result.data.chapters[0]?.bodies).toBeUndefined();
      expect(codes(result)).toContain('prose-dropped');
    }
  });

  it('keeps a body in every style asked for, and drops one in a style that was not', () => {
    const result = parse(
      {
        ...chapter({
          headline: 'The headline.',
          bodies: { simple: 'Short.', 'pros-cons': '**Pros**', narrative: 'Not asked for.' },
        }),
        overviewSummary: { lede: 'A lede.' },
      },
      ['simple', 'pros-cons'],
    );
    expect(result.ok && result.data.chapters[0]?.bodies).toEqual({
      simple: 'Short.',
      'pros-cons': '**Pros**',
    });
    expect(result.findings.find((f) => f.code === 'body-style-dropped')?.message).toBe(
      'Chapter c has a body in "narrative", a style this review did not ask for.',
    );
  });

  it('carries the styles asked for, tldr too, though tldr is never a body', () => {
    const result = parse(
      chapter({ headline: 'The headline.', bodies: { plain: 'Plain words.', tldr: 'No.' } }),
      ['tldr', 'plain'],
    );
    expect(result.ok && result.data.overviewStyles).toEqual(['tldr', 'plain']);
    expect(result.ok && result.data.chapters[0]?.bodies).toEqual({ plain: 'Plain words.' });
    expect(codes(result)).toContain('body-style-dropped');
  });

  it('takes a lone body as the one style asked for, and as no style when several were', () => {
    const one = parse(chapter({ headline: 'The headline.', body: 'Forgot the key.' }), ['plain']);
    expect(one.ok && one.data.chapters[0]?.bodies).toEqual({ plain: 'Forgot the key.' });
    expect(one.findings.find((f) => f.code === 'prose-promoted')?.message).toBe(
      'Chapter c sent a "body" rather than "bodies", which became its plain body.',
    );
    const several = parse(
      {
        ...chapter({ headline: 'The headline.', body: 'Whose is this?' }),
        overviewSummary: { lede: 'A lede.', bodies: { plain: 'Plain.', simple: 'Simple.' } },
      },
      ['plain', 'simple'],
    );
    expect(several.ok && several.data.chapters[0]?.bodies).toBeUndefined();
    expect(several.findings.find((f) => f.code === 'prose-dropped')?.message).toBe(
      'Chapter c sent a "body" that no one style could claim.',
    );
  });

  it('fails the review when a style asked for beside others has no body anywhere', () => {
    const result = parse(
      {
        ...chapter({ headline: 'The headline.', bodies: { simple: 'Short.' } }),
        overviewSummary: { lede: 'A lede.', bodies: { simple: 'Short too.' } },
      },
      ['narrative', 'simple', 'pros-cons', 'tldr'],
    );
    expect(result.ok).toBe(false);
    expect(result.findings.filter((f) => f.code === 'style-missing').map((f) => f.message)).toEqual(
      [
        'No passage has a body in the narrative style, which this review asked for beside simple.',
        'No passage has a body in the pros-cons style, which this review asked for beside simple.',
      ],
    );
  });

  it('lets a review with no body in any style through, as a single-style one is', () => {
    const result = parse(
      { ...chapter({ headline: 'The headline.' }), overviewSummary: { lede: 'A lede.' } },
      ['plain', 'simple'],
    );
    expect(result.ok).toBe(true);
    expect(codes(result)).not.toContain('style-missing');
  });

  it('keeps a headline past the word limit as written, and notes it', () => {
    const long = Array.from({ length: 21 }, (_, i) => `word${String(i)}`).join(' ');
    const result = parse(chapter({ headline: long }));
    expect(result.ok && result.data.chapters[0]?.headline).toBe(long);
    expect(result.findings.find((f) => f.code === 'headline-long')).toMatchObject({
      chapterId: 'c',
      message: "Chapter c's headline runs to 21 words, past the 20 asked for.",
    });
    const atLimit = parse(chapter({ headline: long.split(' ').slice(1).join(' ') }));
    expect(codes(atLimit)).not.toContain('headline-long');
  });

  it('fails the review when a chapter has no headline to open on, whatever came instead', () => {
    for (const headline of [undefined, '   ', 7, { lede: 'in the wrong shape' }]) {
      const result = parse(
        chapter({ headline, bodies: { narrative: 'A body is not a headline.' } }),
      );
      expect(result.ok).toBe(false);
      expect(firstFatal(result)).toBe(
        'Chapter "C" (c) has no headline, the one sentence its card opens on.',
      );
    }
  });

  it('promotes an overview that arrived as a plain string to its lede', () => {
    const result = parse({ ...chapter({}), overviewSummary: 'one flat string' });
    expect(result.ok && result.data.overviewSummary).toEqual({ lede: 'one flat string' });
  });

  it('promotes the first style’s overview body to the lede when no lede came with it', () => {
    const result = parse(
      {
        ...chapter({ headline: 'The headline.', bodies: { plain: 'Plain.', simple: 'Simple.' } }),
        overviewSummary: { bodies: { simple: 'the simple one', plain: 'the plain one' } },
      },
      ['plain', 'simple'],
    );
    expect(result.ok && result.data.overviewSummary).toEqual({
      lede: 'the plain one',
      bodies: { simple: 'the simple one' },
    });
  });

  it('fails the review when the overview has no prose at all', () => {
    const result = parse({ prTitle: 't', overviewSummary: { bodies: {} }, chapters: [] });
    expect(result.ok).toBe(false);
    expect(firstFatal(result)).toBe('The narrative review has no overview summary.');
  });
});

describe('a chapter that splits one file across two chunks', () => {
  it('merges them into one, deduplicated and in file order', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 'A lede.' },
        chapters: [
          {
            id: 'c',
            title: 'C',
            insights: [{ type: 'highlight', text: 'Once, not twice.', filename: 'src/a.ts' }],
            diffChunks: [
              { filename: 'src/a.ts', language: 'typescript', hunks: read(['H0002']) },
              { filename: 'src/a.ts', language: 'plaintext', hunks: read(['H0001', 'H0002']) },
              { filename: 'src/b.ts', language: 'typescript', hunks: read(['H0003']) },
            ],
          },
        ],
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );

    const merged = result.ok ? result.data.chapters[0] : undefined;
    expect(merged?.diffChunks.map((chunk) => chunk.filename)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(merged?.diffChunks[0]?.language).toBe('typescript');
    expect(merged?.diffChunks[0]?.hunks.map((hunk) => hunk.id)).toEqual(['H0001', 'H0002']);
    // The point of the merge: one card for the file, so its anchored insight
    // is drawn once rather than once per chunk the model split it into.
    expect(merged?.insights).toEqual([
      { type: 'highlight', text: 'Once, not twice.', filename: 'src/a.ts' },
    ]);
  });
});

describe('an insight anchored to a file', () => {
  const parse = (insights: unknown) =>
    parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'c',
            title: 'C',
            headline: 'd',
            insights,
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: read(['H0001']) }],
          },
        ],
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );

  it('keeps a filename the chapter cites', () => {
    const result = parse([{ type: 'highlight', text: 'about this file', filename: 'src/a.ts' }]);
    expect(result.ok && result.data.chapters[0]?.insights).toEqual([
      { type: 'highlight', text: 'about this file', filename: 'src/a.ts' },
    ]);
  });

  it('drops an anchor the chapter does not cite, and keeps the insight', () => {
    // The second file is in the diff but not in this chapter, so its card is
    // not on the page — anchored there the insight would be drawn nowhere.
    const result = parse([{ type: 'context', text: 'still worth saying', filename: 'src/b.ts' }]);
    expect(result.ok && result.data.chapters[0]?.insights).toEqual([
      { type: 'context', text: 'still worth saying' },
    ]);
  });
});

const call = (over: Record<string, unknown> = {}) => ({
  title: 'Hourly cadence offered to every repo',
  text: 'Cheap if few choose it, expensive if most do.',
  filename: 'src/a.ts',
  hunkIds: ['H0001'],
  ...over,
});

describe('a judgement call', () => {
  const parse = (judgementCalls: unknown) =>
    parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          { id: 'c', title: 'C', insights: [], diffChunks: [cite('src/a.ts', ['H0001', 'H0002'])] },
          { id: 'd', title: 'D', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
        ],
        judgementCalls,
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );

  it('survives with the hunks it named, in file order', () => {
    const result = parse([call({ hunkIds: ['H0002', 'H0001'] })]);
    expect(result.ok && result.data.judgementCalls).toEqual([
      call({ hunkIds: ['H0001', 'H0002'] }),
    ]);
  });

  it('is absent, not empty, when the model asked nothing', () => {
    const result = parse(undefined);
    expect(result.ok && 'judgementCalls' in result.data).toBe(false);
    expect(codes(result)).not.toContain('judgement-call-dropped');
  });

  it('is dropped in full when no chapter cites its file, since it has no card to sit on', () => {
    const result = parse([call({ filename: 'src/c.ts', hunkIds: ['H0001'] })]);
    expect(result.ok && result.data.judgementCalls).toBeUndefined();
    expect(codes(result)).toContain('judgement-call-dropped');
  });

  it('is dropped when every hunk it cites belongs to another file', () => {
    // src/a.ts is cited by a chapter, so the anchor stands; H0003 is src/b.ts,
    // so the question points at lines this card does not show.
    const result = parse([call({ hunkIds: ['H0003'] })]);
    expect(result.ok && result.data.judgementCalls).toBeUndefined();
    expect(codes(result)).toContain('judgement-hunk-id-dropped');
    expect(codes(result)).toContain('judgement-call-dropped');
  });

  it('keeps the hunks that resolved and records the one that did not', () => {
    const result = parse([call({ hunkIds: ['H0001', 'H9999'] })]);
    expect(result.ok && result.data.judgementCalls).toEqual([call({ hunkIds: ['H0001'] })]);
    expect(codes(result)).toContain('judgement-hunk-id-dropped');
    expect(codes(result)).not.toContain('judgement-call-dropped');
  });

  it('keeps only the hunks of the chapter that draws it, when two chapters split its file', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          { id: 'c', title: 'C', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
          { id: 'd', title: 'D', insights: [], diffChunks: [cite('src/a.ts', ['H0002'])] },
          { id: 'e', title: 'E', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
        ],
        judgementCalls: [call({ hunkIds: ['H0002', 'H0001'] })],
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );
    // Drawn in chapter c, the first showing one of its hunks; H0002 is on
    // chapter d's card, where the question will not be.
    expect(result.ok && result.data.judgementCalls).toEqual([call({ hunkIds: ['H0001'] })]);
    expect(codes(result)).toContain('judgement-hunk-id-dropped');
    expect(codes(result)).not.toContain('judgement-call-dropped');
  });

  it('is dropped without a title or without text, either of which leaves no question', () => {
    expect(parse([call({ title: '  ' })]).ok).toBe(true);
    expect(codes(parse([call({ title: '  ' })]))).toContain('judgement-call-dropped');
    expect(codes(parse([call({ text: undefined })]))).toContain('judgement-call-dropped');
  });

  it('is capped at three, however many the model asked', () => {
    const result = parse([
      call({ title: 'one' }),
      call({ title: 'two' }),
      call({ title: 'three' }),
      call({ title: 'four' }),
    ]);
    expect(result.ok && result.data.judgementCalls?.map((c) => c.title)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(codes(result)).toContain('judgement-call-dropped');
  });
});

describe('a quote the model forgot to escape', () => {
  // What a real review sent, and what it used to cost: one unescaped pair
  // inside a 37 KB answer, and the whole run thrown away.
  const STRAY = `{ "prTitle": "T", "overviewSummary": { "lede": "a ${DQ}no hunks${DQ} message" }, "chapters": [] }`;

  it('is escaped, so the review survives', () => {
    const result = parseNarrativeReview(`<narrative_review>${STRAY}</narrative_review>`);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data.overviewSummary).toEqual({
      lede: `a ${DQ}no hunks${DQ} message`,
    });
  });

  it('leaves valid JSON exactly as it was', () => {
    const valid = JSON.stringify({
      prTitle: 'T',
      overviewSummary: { lede: `escaped ${DQ}quotes${DQ}, a brace } and a comma, inside` },
      chapters: [{ id: 'a', title: 'A', insights: [], diffChunks: [] }],
    });

    expect(escapeStrayQuotes(valid)).toBe(valid);
  });

  it('still fails cleanly on what it cannot repair', () => {
    // A stray quote directly before a comma reads as the end of the string.
    const beyond = `{ "prTitle": "T", "overviewSummary": { "lede": "he said ${DQ}hi${DQ}, then left" }, "chapters": [] }`;
    const result = parseNarrativeReview(`<narrative_review>${beyond}</narrative_review>`);

    expect(result.ok).toBe(false);
    expect(firstFatal(result)).toContain('not valid JSON');
  });
});

describe('what a repair records', () => {
  const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
  const parse = (chapters: unknown[], extra: Record<string, unknown> = {}): ParseResult =>
    parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: { lede: 's' }, chapters, ...extra }),
      grounding,
    );

  it('records nothing for an answer that needed no repair', () => {
    const result = parse([
      { id: 'c', title: 'C', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
    ]);
    expect(result.findings).toEqual([]);
  });

  it('notes a synthesised id and title against the chapter they were given to', () => {
    const result = parse([{ insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] }]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'chapter-id-synthesised',
        severity: 'note',
        chapterId: 'chapter-1',
      }),
      expect.objectContaining({ code: 'chapter-title-synthesised', chapterId: 'chapter-1' }),
    ]);
  });

  it('gives a repeated chapter id a fresh one, the first holder keeping it, and warns', () => {
    const result = parse(
      [
        { id: 'auth', title: 'A', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
        { id: 'auth', title: 'B', insights: [], diffChunks: [cite('src/a.ts', ['H0002'])] },
        { id: '__summary__', title: 'C', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
      ],
      { readingPlan: { brief: ['auth'], standard: ['auth'] } },
    );
    expect(result.ok && result.data.chapters.map((c) => c.id)).toEqual([
      'auth',
      'chapter-2',
      'chapter-3',
    ]);
    expect(result.ok && result.data.readingPlan).toEqual({ brief: ['auth'], standard: ['auth'] });
    expect(result.findings.filter((f) => f.code === 'chapter-id-duplicate')).toEqual([
      expect.objectContaining({ severity: 'warning', chapterId: 'chapter-2' }),
      expect.objectContaining({ severity: 'warning', chapterId: 'chapter-3' }),
    ]);
  });

  it('keeps every model id a synthesised one would have taken, and synthesises around it', () => {
    const result = parse(
      [
        { title: 'A', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
        { id: 'chapter-1', title: 'B', insights: [], diffChunks: [cite('src/a.ts', ['H0002'])] },
        { id: 'chapter-4', title: 'C', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
        { title: 'D', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
      ],
      { readingPlan: { brief: ['chapter-1'], standard: ['chapter-1'] } },
    );
    expect(result.ok && result.data.chapters.map((c) => c.id)).toEqual([
      'chapter-1-2',
      'chapter-1',
      'chapter-4',
      'chapter-4-2',
    ]);
    expect(codes(result).filter((code) => code.startsWith('chapter-id'))).toEqual([
      'chapter-id-synthesised',
      'chapter-id-synthesised',
    ]);
    expect(result.ok && result.data.readingPlan?.brief).toEqual(['chapter-1']);
  });

  it('never gives a made-up id to a chapter whose own id a later chapter holds', () => {
    const result = parse(
      [
        { title: 'A', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
        { id: 'x', title: 'B', insights: [], diffChunks: [cite('src/a.ts', ['H0002'])] },
        { id: 'chapter-1', title: 'C', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
        { id: 'chapter-3', title: 'D', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
      ],
      { readingPlan: { brief: ['chapter-3'], standard: ['chapter-3'] } },
    );
    expect(result.ok && result.data.chapters.map((c) => [c.id, c.title])).toEqual([
      ['chapter-1-2', 'A'],
      ['x', 'B'],
      ['chapter-1', 'C'],
      ['chapter-3', 'D'],
    ]);
    expect(codes(result)).not.toContain('chapter-id-duplicate');
    expect(result.ok && result.data.readingPlan?.brief).toEqual(['chapter-3']);
  });

  it('notes an overview that arrived as a bare string, or with a body and no lede', () => {
    const cited = [
      { id: 'c', title: 'C', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
    ];
    const bare = parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: 'a bare string', chapters: cited }),
    );
    const bodyOnly = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { bodies: { narrative: 'only the detail' } },
        chapters: cited,
      }),
    );
    expect(codes(bare)).toEqual(['prose-promoted']);
    expect(codes(bodyOnly)).toEqual(['prose-promoted']);
  });

  it('names every chapter with no headline in one go, so one retry can mend them all', () => {
    const result = parse([
      { id: 'c', title: 'C', headline: '', diffChunks: [cite('src/a.ts', ['H0001'])] },
      { id: 'd', title: 'D', diffChunks: [cite('src/b.ts', ['H0003'])] },
      { id: 'e', title: 'E', headline: undefined, diffChunks: [cite('src/a.ts', ['H0002'])] },
    ]);
    expect(result.ok).toBe(false);
    expect(fatalFindings(result.findings).map((f) => [f.code, f.chapterId])).toEqual([
      ['chapter-no-headline', 'c'],
      ['chapter-no-headline', 'e'],
    ]);
  });

  it('notes the stray-quote repair the parse depended on', () => {
    const stray = `{ "prTitle": "T", "overviewSummary": { "lede": "a ${DQ}no hunks${DQ} message" }, "chapters": [] }`;
    const result = parseNarrativeReview(`<narrative_review>${stray}</narrative_review>`);
    expect(codes(result)).toEqual(['json-quote-repaired']);
  });

  it('notes chunks merged by file, and hunk ids that resolved against nothing', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        insights: [],
        diffChunks: [cite('src/a.ts', ['H0001', 'H9999']), cite('src/a.ts', ['H0002'])],
      },
    ]);
    expect(codes(result)).toEqual(['hunk-id-dropped', 'chunks-merged']);
    expect(result.findings[0]).toMatchObject({ chapterId: 'c', filename: 'src/a.ts' });
  });

  it('notes an unknown insight type and an insight with no text', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        insights: [{ type: 'bogus', text: 'kept' }, { type: 'context' }],
        diffChunks: [cite('src/a.ts', ['H0001'])],
      },
    ]);
    expect(codes(result)).toEqual(['insight-type-unknown', 'insight-dropped']);
  });

  it('warns when an insight loses the file it was anchored to', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        insights: [{ type: 'context', text: 'still worth saying', filename: 'src/b.ts' }],
        diffChunks: [cite('src/a.ts', ['H0001'])],
      },
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'insight-anchor-dropped',
        severity: 'warning',
        chapterId: 'c',
        filename: 'src/b.ts',
      }),
    ]);
  });

  it('warns when the risk assessment goes, and notes what it patched up', () => {
    const dropped = parse([{ id: 'c', title: 'C', diffChunks: [cite('src/a.ts', ['H0001'])] }], {
      riskAssessment: { score: 9 },
    });
    expect(dropped.findings).toEqual([
      expect.objectContaining({ code: 'risk-dropped', severity: 'warning' }),
    ]);

    const patched = parse([{ id: 'c', title: 'C', diffChunks: [cite('src/a.ts', ['H0001'])] }], {
      riskAssessment: { score: 3, factors: [{ name: 'no detail' }] },
    });
    expect(codes(patched)).toEqual(['risk-part-dropped', 'risk-part-dropped']);
  });

  it('notes a chunk that names no file, and one with no hunk to resolve', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        insights: [],
        diffChunks: [
          'src/a.ts',
          { language: 'typescript', hunks: read(['H0001']) },
          { filename: 'src/b.ts', language: 'typescript', hunks: 'H0003' },
          { filename: 'src/a.ts', language: 'typescript', hunks: read([]) },
          cite('src/a.ts', ['H0001']),
        ],
      },
    ]);
    expect(codes(result)).toEqual([
      'chunk-dropped',
      'chunk-dropped',
      'chunk-dropped',
      'chunk-dropped',
    ]);
    expect(result.findings[2]).toMatchObject({
      severity: 'note',
      chapterId: 'c',
      filename: 'src/b.ts',
    });
    expect(result.findings[2]?.message).toContain('no hunk to resolve');
    // The one usable chunk keeps the chapter, so nothing here is fatal.
    expect(result.ok).toBe(true);
  });

  it('notes an overview that arrived with nothing readable in it before failing on it', () => {
    const result = parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: { lede: '   ' }, chapters: [] }),
    );
    expect(codes(result)).toEqual(['prose-dropped', 'fields-missing']);
  });

  it('notes a risk assessment that gave its factors as something other than a list', () => {
    const result = parse([{ id: 'c', title: 'C', diffChunks: [cite('src/a.ts', ['H0001'])] }], {
      riskAssessment: { score: 3, summary: 'Fine.', rationale: '', factors: 'none' },
    });
    expect(codes(result)).toEqual(['risk-part-dropped']);
  });

  it('disqualifies the answer, once per empty chapter, and reports the first', () => {
    const result = parse([
      { id: 'empty', title: 'Empty', insights: [], diffChunks: [] },
      { id: 'alsoEmpty', title: 'Also empty', insights: [], diffChunks: [] },
      { id: 'real', title: 'Real', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
    ]);
    expect(codes(result)).toEqual(['chapter-no-hunks', 'chapter-no-hunks']);
    expect(result.findings.every((f) => f.severity === 'fatal')).toBe(true);
    expect(firstFatal(result)).toContain('"Empty" (empty)');
  });

  it('disqualifies an answer with no block in it', () => {
    const result = parseNarrativeReview('I had a look but I would rather not.');
    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'answer-missing-block', severity: 'fatal' }),
    ]);
  });
});

describe('an answer that contains more than one block', () => {
  const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
  const block = (prTitle: string, chapterId: string) =>
    wrap({
      prTitle,
      overviewSummary: { lede: 's' },
      chapters: [
        {
          id: chapterId,
          title: 'C',
          insights: [],
          diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunks: read(['H0001']) }],
        },
      ],
    });

  it('takes the last complete one, since that is the corrected answer', () => {
    const result = parseNarrativeReview(
      `${block('First attempt', 'one')}
Let me do that again.
${block('Second attempt', 'two')}`,
      grounding,
    );
    expect(result.ok && result.data.prTitle).toBe('Second attempt');
    expect(result.ok && result.data.chapters.map((c) => c.id)).toEqual(['two']);
  });

  it('ignores a second block that has not been closed yet', () => {
    const result = parseNarrativeReview(
      `${block('First attempt', 'one')}
<narrative_review>{"prTitle":"Half a`,
      grounding,
    );
    expect(result.ok && result.data.prTitle).toBe('First attempt');
  });

  /**
   * The model talks about what it just did, and the sentence it reaches for
   * names both tags. Reading the last pair regardless would hand the parser a
   * few words of prose and disqualify an answer that is perfectly correct.
   */
  it('reads past a closing remark that names the tags', () => {
    const result = parseNarrativeReview(
      `${block('The answer', 'one')}
I have re-emitted the complete <narrative_review>…</narrative_review> block as asked.`,
      grounding,
    );
    expect(result.ok && result.data.prTitle).toBe('The answer');
    expect(fatalFindings(result.findings)).toEqual([]);
  });

  it('falls back to the last block that parses when a later one is malformed', () => {
    const result = parseNarrativeReview(
      `${block('The answer', 'one')}
<narrative_review>{ "prTitle": "Cut off mid-</narrative_review>`,
      grounding,
    );
    expect(result.ok && result.data.prTitle).toBe('The answer');
  });

  it('reads past an empty block written after the answer', () => {
    const result = parseNarrativeReview(
      `${block('The answer', 'one')}
<narrative_review>{}</narrative_review>`,
      grounding,
    );
    expect(result.ok && result.data.prTitle).toBe('The answer');
  });

  it('takes the one block of three that is an answer', () => {
    const result = parseNarrativeReview(
      `<narrative_review>{ "prTitle": "Only a title" }</narrative_review>
${block('The answer', 'one')}
<narrative_review>{ "prTitle": "Cut off mid-</narrative_review>`,
      grounding,
    );
    expect(result.ok && result.data.prTitle).toBe('The answer');
  });

  /**
   * What this tool reviewing its own repository writes: an insight about the
   * parser quotes the tags it pairs. Cutting the body at the first closing tag
   * after the opening one takes a correct answer apart at a tag that was never
   * a tag, and then fails the review three refusals later.
   */
  it('reads a closing tag quoted inside the answer as part of the answer', () => {
    const text = wrap({
      prTitle: 'Reviewing the reviewer',
      overviewSummary: { lede: 's' },
      chapters: [
        {
          id: 'one',
          title: 'C',
          insights: [
            {
              type: 'context',
              text: 'The parser pairs <narrative_review> with the </narrative_review> after it.',
            },
          ],
          diffChunks: [cite('src/a.ts', ['H0001'])],
        },
      ],
    });
    const result = parseNarrativeReview(text, grounding);

    expect(result.ok && result.data.prTitle).toBe('Reviewing the reviewer');
    expect(result.ok && result.data.chapters[0]?.insights[0]?.text).toContain(
      '</narrative_review>',
    );
    expect(fatalFindings(result.findings)).toEqual([]);
  });

  it('reads an opening tag quoted inside the answer as part of the answer', () => {
    const text = wrap({
      prTitle: 'Reviewing the reviewer',
      overviewSummary: { lede: 'Every answer opens with <narrative_review>.' },
      chapters: [
        { id: 'one', title: 'C', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
      ],
    });
    const result = parseNarrativeReview(text, grounding);
    expect(result.ok && result.data.prTitle).toBe('Reviewing the reviewer');
  });

  it('reports no block for an opening tag that was never closed', () => {
    expect(error('<narrative_review>{ "prTitle": "Half a')).toBe(
      'The answer contains no complete <narrative_review> block.',
    );
  });

  it('reports no block for a closing tag that comes before every opening one', () => {
    expect(error(`</narrative_review>\n<narrative_review>{ "prTitle": "x", "chapters": [] }`)).toBe(
      'The answer contains no complete <narrative_review> block.',
    );
  });

  it('reports an empty block as JSON it cannot read', () => {
    expect(error('<narrative_review></narrative_review>')).toBe(
      'The <narrative_review> block is not valid JSON.',
    );
  });

  it('reports the missing fields of the only block there is', () => {
    expect(error(wrap({ prTitle: 'x', overviewSummary: { lede: 's' } }))).toBe(
      'The narrative review has no chapters array.',
    );
    expect(error(wrap({ chapters: [], overviewSummary: { lede: 's' } }))).toBe(
      'The narrative review has no prTitle.',
    );
  });
});

describe('the repairs a reader never sees', () => {
  const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
  const parse = (chapters: unknown[], extra: Record<string, unknown> = {}): ParseResult =>
    parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: { lede: 's' }, chapters, ...extra }),
      grounding,
    );
  const oneChapter = (over: Record<string, unknown> = {}) => ({
    id: 'c',
    title: 'C',
    insights: [],
    diffChunks: [cite('src/a.ts', ['H0001'])],
    ...over,
  });

  it('notes insights that arrived as something other than a list', () => {
    const result = parse([oneChapter({ insights: 'a paragraph about the code' })]);
    expect(codes(result)).toEqual(['insight-dropped']);
    expect(result.findings[0]?.message).toContain('something other than a list');
    expect(result.ok && result.data.chapters[0]?.insights).toEqual([]);
  });

  it('drops an insight whose text is nothing but space, as its doc says', () => {
    const result = parse([oneChapter({ insights: [{ type: 'context', text: '   ' }] })]);
    expect(codes(result)).toEqual(['insight-dropped']);
    expect(result.ok && result.data.chapters[0]?.insights).toEqual([]);
  });

  it('notes a risk rationale that was not text', () => {
    const result = parse([oneChapter()], {
      riskAssessment: { score: 3, summary: 'Fine.', rationale: { why: 'nested' }, factors: [] },
    });
    expect(codes(result)).toEqual(['risk-part-dropped']);
    expect(result.ok && result.data.riskAssessment?.rationale).toBe('');
  });

  it('notes the score it rounded, and what it rounded from', () => {
    const result = parse([oneChapter()], {
      riskAssessment: { score: 3.4, summary: 'Fine.', rationale: '', factors: [] },
    });
    expect(codes(result)).toEqual(['risk-part-dropped']);
    expect(result.findings[0]?.message).toBe('The risk score arrived as 3.4 and was rounded to 3.');
    expect(result.ok && result.data.riskAssessment?.score).toBe(3);
  });

  it('notes a hunk id a chunk cited twice, and keeps one of it', () => {
    const result = parse([oneChapter({ diffChunks: [cite('src/a.ts', ['H0001', 'H0001'])] })]);
    expect(codes(result)).toEqual(['chunks-merged']);
    expect(result.findings[0]).toMatchObject({ chapterId: 'c', filename: 'src/a.ts' });
    expect(result.ok && result.data.chapters[0]?.diffChunks[0]?.hunks.map((h) => h.id)).toEqual([
      'H0001',
    ]);
  });

  it('leaves the filename off a dropped hunk id when the chunk named no file', () => {
    const result = parse([
      oneChapter({ diffChunks: [cite('', ['H0001']), cite('src/a.ts', ['H0001'])] }),
    ]);
    const dropped = result.findings.find((f) => f.code === 'hunk-id-dropped');
    expect(dropped).toBeDefined();
    expect(dropped && 'filename' in dropped).toBe(false);
  });
});

/** Each cited hunk of the first chapter as [id, tier]. */
const tiers = (result: ParseResult) =>
  result.ok
    ? result.data.chapters[0]!.diffChunks.flatMap((chunk) =>
        chunk.hunks.map((hunk) => [hunk.id, hunk.tier]),
      )
    : null;

describe('a cited hunk’s tier', () => {
  const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
  const parse = (...chunks: unknown[]): ParseResult =>
    parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [{ id: 'c', title: 'C', insights: [], diffChunks: chunks }],
      }),
      grounding,
    );
  it('keeps each tier as sent', () => {
    const result = parse(
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: [
          { id: 'H0001', tier: 'skim' },
          { id: 'H0002', tier: 'skim' },
        ],
      },
      { filename: 'src/b.ts', language: 'typescript', hunks: [{ id: 'H0003', tier: 'read' }] },
    );
    expect(tiers(result)).toEqual([
      ['H0001', 'skim'],
      ['H0002', 'skim'],
      ['H0003', 'read'],
    ]);
    expect(result.findings).toEqual([]);
  });

  it('keeps a skim hunk’s reason, trimmed, and drops one on a read hunk or a blank one', () => {
    const result = parse(
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: [
          { id: 'H0001', tier: 'skim', skimReason: '  test fixtures ' },
          { id: 'H0002', tier: 'skim', skimReason: ' ' },
        ],
      },
      {
        filename: 'src/b.ts',
        language: 'typescript',
        hunks: [{ id: 'H0003', tier: 'read', skimReason: 'imports' }],
      },
    );
    const reasons = result.ok
      ? result.data.chapters[0]!.diffChunks.flatMap((chunk) =>
          chunk.hunks.map((hunk) => [hunk.id, hunk.skimReason]),
        )
      : null;
    expect(reasons).toEqual([
      ['H0001', 'test fixtures'],
      ['H0002', undefined],
      ['H0003', undefined],
    ]);
  });

  it('drops a skim reason too long to be a label, keeping the hunk skim, in one note', () => {
    const result = parse({
      filename: 'src/a.ts',
      language: 'typescript',
      hunks: [
        {
          id: 'H0001',
          tier: 'skim',
          skimReason: 'these lines only set up the shared fixtures the cases below use',
        },
      ],
    });
    const hunk = result.ok ? result.data.chapters[0]!.diffChunks[0]!.hunks[0] : null;
    expect([hunk?.tier, hunk?.skimReason]).toEqual(['skim', undefined]);
    expect(result.findings.map((f) => [f.code, f.hunkIds])).toEqual([
      ['skim-reason-dropped', ['H0001']],
    ]);
  });

  it('reads a bare id, a missing tier and an unknown one as read, in one warning', () => {
    const result = parse(
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: ['H0001', { id: 'H0002', tier: 'mechanical' }],
      },
      { filename: 'src/b.ts', language: 'typescript', hunks: [{ id: 'H0003' }] },
    );
    expect(tiers(result)).toEqual([
      ['H0001', 'read'],
      ['H0002', 'read'],
      ['H0003', 'read'],
    ]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'hunk-tier-missing',
        severity: 'warning',
        hunkIds: ['H0001', 'H0002', 'H0003'],
      }),
    ]);
    expect(result.findings[0]?.message).toMatch(/^3 cited hunks /);
  });

  it('raises a hunk a judgement call asks about to read on the card that asks it, in one note', () => {
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'first',
            title: 'First',
            insights: [],
            diffChunks: [
              {
                filename: 'src/a.ts',
                language: 'typescript',
                hunks: [
                  { id: 'H0001', tier: 'skim' },
                  { id: 'H0002', tier: 'skim' },
                ],
              },
              { filename: 'src/b.ts', language: 'typescript', hunks: read(['H0003']) },
            ],
          },
          {
            id: 'second',
            title: 'Second',
            insights: [],
            diffChunks: [
              {
                filename: 'src/a.ts',
                language: 'typescript',
                hunks: [{ id: 'H0001', tier: 'skim' }],
              },
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Q',
            text: 'Is this import needed?',
            filename: 'src/a.ts',
            hunkIds: ['H0001', 'H0002'],
          },
          { title: 'R', text: 'Is this right?', filename: 'src/b.ts', hunkIds: ['H0003'] },
        ],
      }),
      grounding,
    );
    expect(tiers(result)).toEqual([
      ['H0001', 'read'],
      ['H0002', 'read'],
      ['H0003', 'read'],
    ]);
    // Only the card that draws the question is raised.
    expect(result.ok && result.data.chapters[1]?.diffChunks[0]?.hunks[0]).toMatchObject({
      tier: 'skim',
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: 'hunk-tier-raised',
        severity: 'note',
        hunkIds: ['H0001', 'H0002'],
      }),
    ]);
  });

  it('keeps the more attentive tier of a hunk cited twice, in one chunk or across two', () => {
    const result = parse(
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: [
          { id: 'H0001', tier: 'skim' },
          { id: 'H0001', tier: 'skim' },
          { id: 'H0002', tier: 'skim' },
        ],
      },
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: [{ id: 'H0002', tier: 'read' }],
      },
    );
    expect(tiers(result)).toEqual([
      ['H0001', 'skim'],
      ['H0002', 'read'],
    ]);
    expect(codes(result)).toEqual(['chunks-merged', 'chunks-merged']);
  });

  it('carries the catalog’s proven facts onto the hunk, and skims a whitespace-only one whatever its tier', () => {
    const facts = groundingFor(
      buildDiffHunkIndex(DIFF).hunks.map((hunk) => {
        if (hunk.id === 'H0001') {
          return { ...hunk, movedFrom: { filename: 'src/c.ts', similarity: 100 } };
        }
        if (hunk.id === 'H0002') {
          return { ...hunk, movedFrom: { filename: 'src/c.ts', similarity: 90 } };
        }
        if (hunk.id === 'H0003') return { ...hunk, whitespaceOnly: true as const };
        return hunk;
      }),
    );
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'c',
            title: 'C',
            insights: [],
            diffChunks: [
              {
                filename: 'src/a.ts',
                language: 'typescript',
                hunks: [{ id: 'H0001', tier: 'read' }, 'H0002'],
              },
              {
                filename: 'src/b.ts',
                language: 'typescript',
                hunks: [{ id: 'H0003', tier: 'read' }],
              },
            ],
          },
        ],
      }),
      facts,
    );
    // A move unchanged keeps the model's tier.
    expect(tiers(result)).toEqual([
      ['H0001', 'read'],
      ['H0002', 'read'],
      ['H0003', 'skim'],
    ]);
    expect(result.ok && result.data.chapters[0]?.diffChunks[0]?.hunks[0]?.movedFrom).toEqual({
      filename: 'src/c.ts',
      similarity: 100,
    });
    expect(result.ok && result.data.chapters[0]?.diffChunks[1]?.hunks[0]?.whitespaceOnly).toBe(
      true,
    );
    expect(result.findings.map((f) => [f.code, f.hunkIds])).toEqual([
      ['hunk-tier-missing', ['H0002']],
      ['hunk-tier-lowered', ['H0003']],
    ]);
  });

  it('skims an imports-only hunk whatever its tier, as it does a whitespace-only one', () => {
    const facts = groundingFor(
      buildDiffHunkIndex(DIFF).hunks.map((hunk) =>
        hunk.id === 'H0001' ? { ...hunk, importsOnly: true as const } : hunk,
      ),
    );
    const result = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'c',
            title: 'C',
            insights: [],
            diffChunks: [
              {
                filename: 'src/a.ts',
                language: 'typescript',
                hunks: [{ id: 'H0001', tier: 'read' }],
              },
            ],
          },
        ],
      }),
      facts,
    );
    expect(tiers(result)).toEqual([['H0001', 'skim']]);
    expect(result.ok && result.data.chapters[0]?.diffChunks[0]?.hunks[0]?.importsOnly).toBe(true);
    expect(result.findings.map((f) => [f.code, f.hunkIds])).toEqual([
      ['hunk-tier-lowered', ['H0001']],
    ]);
  });
});

describe('a reading plan', () => {
  const grounding = groundingFor(buildDiffHunkIndex(DIFF).hunks);
  const chapters = [
    { id: 'types', title: 'Types', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
    { id: 'core', title: 'Core', insights: [], diffChunks: [cite('src/a.ts', ['H0002'])] },
    { id: 'wiring', title: 'Wiring', insights: [], diffChunks: [cite('src/b.ts', ['H0003'])] },
  ];
  const parse = (readingPlan: unknown, withChapters: unknown[] = chapters) =>
    parseNarrativeReview(
      wrap({ prTitle: 't', overviewSummary: { lede: 's' }, chapters: withChapters, readingPlan }),
      grounding,
    );

  it('keeps the chapters each list names, in chapter order, with nothing to report', () => {
    const result = parse({ brief: ['core'], standard: ['wiring', 'core', 'types'] });
    expect(result.ok && result.data.readingPlan).toEqual({
      brief: ['core'],
      standard: ['types', 'core', 'wiring'],
    });
    expect(result.findings).toEqual([]);
  });

  it('drops ids that name no chapter, and repeats, in one note', () => {
    const result = parse({ brief: ['core', 'nope', 'core'], standard: ['types', 'core', 7] });
    expect(result.ok && result.data.readingPlan).toEqual({
      brief: ['core'],
      standard: ['types', 'core'],
    });
    expect(codes(result)).toEqual(['reading-plan-id-dropped']);
    expect(result.findings[0]?.message).toBe(
      'The reading plan named "nope", "7", which no chapter is called, and "core" more than once in one list; those entries were dropped.',
    );
  });

  it('names an unknown id once, however many lists it turns up in', () => {
    const result = parse({ brief: ['nope', 'core'], standard: ['nope', 'core'] });
    expect(codes(result)).toEqual(['reading-plan-id-dropped']);
    expect(result.findings[0]?.message).toBe(
      'The reading plan named "nope", which no chapter is called; those entries were dropped.',
    );
  });

  it('widens the standard read to hold the brief, in chapter order, in one note', () => {
    const result = parse({ brief: ['wiring', 'core'], standard: ['types'] });
    expect(result.ok && result.data.readingPlan).toEqual({
      brief: ['core', 'wiring'],
      standard: ['types', 'core', 'wiring'],
    });
    expect(codes(result)).toEqual(['reading-plan-widened']);
    expect(result.findings[0]?.message).toContain('left out "core", "wiring" from its brief');
  });

  it('makes a standard read that never came the brief alone', () => {
    const result = parse({ brief: ['core'] });
    expect(result.ok && result.data.readingPlan).toEqual({ brief: ['core'], standard: ['core'] });
    expect(codes(result)).toEqual(['reading-plan-widened']);
  });

  it('ships the review without a plan that is missing, not an object, or briefs nothing real', () => {
    for (const plan of [
      undefined,
      null,
      'core',
      ['core'],
      { standard: ['core'] },
      { brief: ['nope'], standard: ['core'] },
    ]) {
      const result = parse(plan);
      expect(result.ok).toBe(true);
      expect(result.ok && result.data.readingPlan).toBeUndefined();
      expect(result.findings.filter((f) => f.code === 'reading-plan-dropped')).toEqual([
        expect.objectContaining({ severity: 'warning' }),
      ]);
    }
  });

  it('reads a plan sent as a list as no object at all, rather than as an empty brief', () => {
    const result = parse(['core']);
    expect(result.ok && result.data.readingPlan).toBeUndefined();
    expect(result.findings.map((f) => f.message)).toEqual([
      'The reading plan was not an object, so the review has none.',
    ]);
  });

  it('asks for nothing from a review with no chapters to plan', () => {
    expect(parse(undefined, []).findings).toEqual([]);
  });
});

const excerpt = (filename: string, startLine: unknown, endLine: unknown, reason: unknown) => ({
  filename,
  startLine,
  endLine,
  reason,
});

const excerptsOf = (result: ParseResult) =>
  result.ok ? result.data.chapters.map((each) => each.contextExcerpts) : null;

describe('excerpts of unchanged code', () => {
  // src/c.ts is in the change but skipped, so the prompt showed none of its hunks.
  const grounding = groundingFor(
    buildDiffHunkIndex(DIFF).hunks,
    ['src/a.ts', 'src/b.ts'],
    ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  );
  const parse = (contextExcerpts: unknown) =>
    parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'c1',
            title: 'C',
            insights: [],
            diffChunks: [cite('src/a.ts', ['H0001', 'H0002']), cite('src/b.ts', ['H0003'])],
            contextExcerpts,
          },
        ],
      }),
      grounding,
    );

  it('keeps an excerpt that keeps the rules, its reason trimmed, with nothing to report', () => {
    const result = parse([excerpt('src/runner.ts', 10, 30, ' Calls isDue every pass. ')]);
    expect(excerptsOf(result)).toEqual([
      [
        {
          filename: 'src/runner.ts',
          startLine: 10,
          endLine: 30,
          reason: 'Calls isDue every pass.',
        },
      ],
    ]);
    expect(result.findings).toEqual([]);
  });

  it('leaves the field off a chapter that sent none, or an empty list', () => {
    const result = parse(undefined);
    expect(result.ok && 'contextExcerpts' in result.data.chapters[0]!).toBe(false);
    expect(parse([]).findings).toEqual([]);
  });

  it('drops each excerpt that breaks a rule, and says which and why in one warning', () => {
    const result = parse([
      excerpt('src/a.ts', 1, 5, 'Changed here.'),
      excerpt('src/c.ts', 1, 5, 'Skipped, but still changed.'),
      excerpt('src/runner.ts', 30, 10, 'Backwards.'),
      excerpt('src/runner.ts', 1, 61, 'Too long.'),
      excerpt('src/runner.ts', 0, 5, 'From line zero.'),
      excerpt('src/runner.ts', 1.5, 5, 'Half a line.'),
      excerpt('src/runner.ts', 1, 5, '  '),
      excerpt('', 1, 5, 'No file.'),
      'src/runner.ts',
    ]);
    expect(result.ok).toBe(true);
    expect(excerptsOf(result)).toEqual([undefined]);
    expect(codes(result)).toEqual(['excerpt-dropped']);
    expect(result.findings[0]).toMatchObject({ severity: 'warning' });
    expect(result.findings[0]?.message).toBe(
      '9 excerpts of unchanged code were dropped: ' +
        'src/a.ts L1–5 in chapter c1 (a file this change touches); ' +
        'src/c.ts L1–5 in chapter c1 (a file this change touches); ' +
        'src/runner.ts L30–10 in chapter c1 (its span runs backwards); ' +
        'src/runner.ts L1–61 in chapter c1 (61 lines, over the 60-line limit); ' +
        'src/runner.ts L0–5 in chapter c1 (its lines are not whole numbers from 1); ' +
        'src/runner.ts L1.5–5 in chapter c1 (its lines are not whole numbers from 1); ' +
        'src/runner.ts L1–5 in chapter c1 (it gives no reason); ' +
        'an excerpt L1–5 in chapter c1 (it names no file); ' +
        'an excerpt in chapter c1 (not an object).',
    );
  });

  it('drops a path git would not read as one from the repository root', () => {
    const result = parse([
      excerpt('../outside.ts', 1, 5, 'Above the repository.'),
      excerpt('/etc/hosts', 1, 5, 'Absolute.'),
      excerpt('C:/repo/src/x.ts', 1, 5, 'A drive.'),
      excerpt('./src/x.ts', 1, 5, 'A dot segment.'),
      excerpt(`src${String.fromCharCode(92)}x.ts`, 1, 5, 'A Windows separator.'),
    ]);
    expect(excerptsOf(result)).toEqual([undefined]);
    expect(result.findings[0]?.message).toMatch(/^5 excerpts of unchanged code were dropped: /);
    expect(result.findings[0]?.message.match(/not a path from the repository root/g)).toHaveLength(
      5,
    );
  });

  it('keeps sixty lines exactly', () => {
    const result = parse([excerpt('src/runner.ts', 41, 100, 'Sixty lines.')]);
    expect(excerptsOf(result)?.[0]).toHaveLength(1);
    expect(result.findings).toEqual([]);
  });

  it('keeps the first two that pass, and drops the rest as past the cap', () => {
    const result = parse([
      excerpt('src/a.ts', 1, 5, 'Changed, so not counted against the cap.'),
      excerpt('src/one.ts', 1, 5, 'First.'),
      excerpt('src/two.ts', 1, 5, 'Second.'),
      excerpt('src/three.ts', 1, 5, 'Third.'),
    ]);
    expect(excerptsOf(result)?.[0]?.map((kept) => kept.filename)).toEqual([
      'src/one.ts',
      'src/two.ts',
    ]);
    expect(result.findings[0]?.message).toContain(
      'src/three.ts L1–5 in chapter c1 (past the 2 a chapter may show)',
    );
  });

  it('reports the drops of every chapter in the one warning', () => {
    const both = parseNarrativeReview(
      wrap({
        prTitle: 't',
        overviewSummary: { lede: 's' },
        chapters: [
          {
            id: 'first',
            title: 'First',
            insights: [],
            diffChunks: [cite('src/a.ts', ['H0001', 'H0002'])],
            contextExcerpts: [excerpt('src/a.ts', 1, 5, 'Changed.')],
          },
          {
            id: 'second',
            title: 'Second',
            insights: [],
            diffChunks: [cite('src/b.ts', ['H0003'])],
            contextExcerpts: 'src/runner.ts',
          },
        ],
      }),
      grounding,
    );
    expect(codes(both)).toEqual(['excerpt-dropped']);
    expect(both.findings[0]?.message).toBe(
      '2 excerpts of unchanged code were dropped: src/a.ts L1–5 in chapter first (a file this change touches); its excerpts in chapter second (not a list).',
    );
  });
});
