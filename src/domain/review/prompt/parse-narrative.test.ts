import { describe, expect, it } from 'vitest';
import { buildDiffHunkIndex, groundingFor } from './diff-hunk-catalog.ts';
import { escapeStrayQuotes, parseNarrativeReview, type ParseResult } from './parse-narrative.ts';

function wrap(payload: unknown): string {
  return `Sure, here you go:\n<narrative_review>${JSON.stringify(payload)}</narrative_review>\nDone.`;
}

/** The reported error of an answer that fails, or null when it parses. */
function error(text: string): string | null {
  const result = parseNarrativeReview(text);
  return result.ok ? null : result.error;
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
    expect(!result.ok && result.error).toBe(
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
    expect(!result.ok && result.error).toBe('The narrative review has no overview summary.');
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
    expect(!result.ok && result.error).toContain('not valid JSON');
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

  it('disqualifies the answer, once per empty chapter, and reports the first', () => {
    const result = parse([
      { id: 'empty', title: 'Empty', insights: [], diffChunks: [] },
      { id: 'alsoEmpty', title: 'Also empty', insights: [], diffChunks: [] },
      { id: 'real', title: 'Real', insights: [], diffChunks: [cite('src/a.ts', ['H0001'])] },
    ]);
    expect(codes(result)).toEqual(['chapter-no-hunks', 'chapter-no-hunks']);
    expect(result.findings.every((f) => f.severity === 'fatal')).toBe(true);
    expect(!result.ok && result.error).toContain('"Empty" (empty)');
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
});
