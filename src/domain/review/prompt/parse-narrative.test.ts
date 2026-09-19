import { describe, expect, it } from 'vitest';
import { fatalFindings } from '../findings.ts';
import { buildDiffHunkIndex, groundingFor } from './diff-hunk-catalog.ts';
import { escapeStrayQuotes, parseNarrativeReview, type ParseResult } from './parse-narrative.ts';

function wrap(payload: unknown): string {
  return `Sure, here you go:\n<narrative_review>${JSON.stringify(payload)}</narrative_review>\nDone.`;
}

/** What a failed parse reports: its first fatal finding. Null when it parses. */
function firstFatal(result: ParseResult): string | null {
  return result.ok ? null : (fatalFindings(result.findings)[0]?.message ?? null);
}

function error(text: string): string | null {
  return firstFatal(parseNarrativeReview(text));
}

const codes = (result: ParseResult) => result.findings.map((f) => f.code);

const cite = (filename: string, hunkIds: string[]) => ({
  filename,
  language: 'typescript',
  hunkIds,
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
            description: { lede: 'No id and no title of its own.' },
            insights: [
              { type: 'highlight', title: '  Headline  ', text: 'body' },
              { type: 'bogus', text: 'falls back to context' },
              { type: 'context' },
              'not an insight',
            ],
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0001'] }],
          },
        ],
      }),
      groundingFor(buildDiffHunkIndex(DIFF).hunks),
    );
    expect(result.ok && result.data.chapters).toEqual([
      {
        id: 'chapter-1',
        title: 'Chapter 1',
        description: { lede: 'No id and no title of its own.' },
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
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0001'] }],
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
                hunkIds: ['H0002', 'H0001', 'H0002', 'H0003', 'H9999'],
              },
              { filename: 'src/b.ts', hunkIds: ['H0001'] },
              { filename: 'src/b.ts', language: 'typescript', hunkIds: ['H0003'] },
              { hunkIds: ['H0003'] },
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
        overviewSummary: { lede: 's' },
        chapters: [{ id: 'c', title: 'C', diffChunks: [{ filename: 'a', hunkIds: ['H0001'] }] }],
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
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0001'] }],
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

const chapter = (description: unknown) => ({
  prTitle: 't',
  overviewSummary: { lede: 'A lede.', body: 'And a body.' },
  chapters: [
    {
      id: 'c',
      title: 'C',
      description,
      insights: [],
      diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0001'] }],
    },
  ],
});

describe('prose passages', () => {
  const parse = (payload: unknown) =>
    parseNarrativeReview(wrap(payload), groundingFor(buildDiffHunkIndex(DIFF).hunks));

  it('keeps a lede and a body apart', () => {
    const result = parse(chapter({ lede: 'The lede.', body: '- a\n- b' }));
    expect(result.ok && result.data.chapters[0]?.description).toEqual({
      lede: 'The lede.',
      body: '- a\n- b',
    });
    expect(result.ok && result.data.overviewSummary).toEqual({
      lede: 'A lede.',
      body: 'And a body.',
    });
  });

  it('promotes a plain-string description to a lede', () => {
    const result = parse(chapter('one flat string, not the object the prompt asks for'));
    expect(result.ok && result.data.chapters[0]?.description).toEqual({
      lede: 'one flat string, not the object the prompt asks for',
    });
  });

  it('drops a description with no prose in it whatever its shape', () => {
    for (const description of [7, null, ['a lede'], '   ', {}]) {
      const result = parse(chapter(description));
      expect(result.ok && result.data.chapters[0]?.description).toBeUndefined();
    }
  });

  it('promotes a body that arrived without a lede', () => {
    const result = parse(chapter({ body: 'only the detail' }));
    expect(result.ok && result.data.chapters[0]?.description).toEqual({ lede: 'only the detail' });
  });

  it('drops a description with nothing in it', () => {
    const result = parse(chapter({ lede: '   ', body: '' }));
    expect(result.ok && result.data.chapters[0]?.description).toBeUndefined();
  });

  it('fails the review when the overview has no prose at all', () => {
    const result = parse({ prTitle: 't', overviewSummary: { body: '' }, chapters: [] });
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
              { filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0002'] },
              { filename: 'src/a.ts', language: 'plaintext', hunkIds: ['H0001', 'H0002'] },
              { filename: 'src/b.ts', language: 'typescript', hunkIds: ['H0003'] },
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
            description: { lede: 'd' },
            insights,
            diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0001'] }],
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

  it('notes prose that arrived as a bare string, and prose that arrived with no lede', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        description: 'a bare string',
        insights: [],
        diffChunks: [cite('src/a.ts', ['H0001'])],
      },
      {
        id: 'd',
        title: 'D',
        description: { body: 'only the detail' },
        insights: [],
        diffChunks: [cite('src/b.ts', ['H0003'])],
      },
    ]);
    expect(codes(result)).toEqual(['prose-promoted', 'prose-promoted']);
    expect(result.findings[0]?.chapterId).toBe('c');
    expect(result.findings[1]?.chapterId).toBe('d');
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

  it('notes a chunk that names no file, and one with no hunk id to resolve', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        insights: [],
        diffChunks: [
          'src/a.ts',
          { language: 'typescript', hunkIds: ['H0001'] },
          { filename: 'src/b.ts', language: 'typescript', hunkIds: 'H0003' },
          { filename: 'src/a.ts', language: 'typescript', hunkIds: [] },
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
    expect(result.findings[2]?.message).toContain('no hunk id to resolve');
    // The one usable chunk keeps the chapter, so nothing here is fatal.
    expect(result.ok).toBe(true);
  });

  it('notes prose that arrived with nothing readable in it, and nothing for prose that never came', () => {
    const result = parse([
      {
        id: 'c',
        title: 'C',
        description: '   ',
        insights: [],
        diffChunks: [cite('src/a.ts', ['H0001'])],
      },
      {
        id: 'd',
        title: 'D',
        description: { lede: '', body: '  ' },
        insights: [],
        diffChunks: [cite('src/b.ts', ['H0003'])],
      },
      {
        id: 'e',
        title: 'E',
        description: 7,
        insights: [],
        diffChunks: [cite('src/a.ts', ['H0002'])],
      },
      { id: 'f', title: 'F', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
    ]);
    expect(codes(result)).toEqual(['prose-dropped', 'prose-dropped', 'prose-dropped']);
    expect(result.findings[0]).toMatchObject({ severity: 'note', chapterId: 'c' });
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
          diffChunks: [{ filename: 'src/a.ts', language: 'typescript', hunkIds: ['H0001'] }],
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
