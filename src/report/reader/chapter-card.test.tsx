import { describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/review/bundle';
import type { DiffChunk, Insight, JudgementCall, NarrativeChapter } from '@/review/narrative';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { render, screen, within } from '@/report/test/render';
import { ChapterCard, groupInsightsByFile, orderChunksTestsLast } from './chapter-card';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  loader: { config: () => {}, init: () => Promise.resolve({}) },
}));

function chunk(filename: string): DiffChunk {
  return { filename, language: 'typescript', hunks: [] };
}

describe('groupInsightsByFile', () => {
  const orient: Insight = { type: 'context', text: 'read this first' };
  const onA: Insight = { type: 'highlight', text: 'about a', filename: 'src/a.ts' };
  const alsoOnA: Insight = { type: 'rationale', text: 'also about a', filename: 'src/a.ts' };
  const onB: Insight = { type: 'context', text: 'about b', filename: 'src/b.ts' };

  it('sends an anchored insight to its file and leaves the rest above the diffs', () => {
    const { anchored, unanchored } = groupInsightsByFile([orient, onA, onB]);
    expect(unanchored).toEqual([orient]);
    expect(anchored.get('src/a.ts')).toEqual([onA]);
    expect(anchored.get('src/b.ts')).toEqual([onB]);
  });

  it('collects several insights on one file, in the order written', () => {
    const { anchored } = groupInsightsByFile([alsoOnA, onA]);
    expect(anchored.get('src/a.ts')).toEqual([alsoOnA, onA]);
  });

  it('has no anchors for a chapter whose insights all orient', () => {
    const { anchored, unanchored } = groupInsightsByFile([orient]);
    expect(anchored.size).toBe(0);
    expect(unanchored).toEqual([orient]);
  });
});

describe('<ChapterCard /> with a mix of insights', () => {
  const chapter: NarrativeChapter = {
    id: 'ch1',
    title: 'Removals pipeline',
    description: { lede: 'Late cancellations stop counting against a tech.', body: '- one\n- two' },
    insights: [
      { type: 'context', title: 'Read this first', text: 'Orientation, before any code.' },
      {
        type: 'rationale',
        title: 'Why the margin is 14 days',
        text: 'Business days have no fixed calendar width.',
        filename: 'src/constants.ts',
      },
    ],
    diffChunks: [chunk('src/pipeline.ts'), chunk('src/constants.ts')],
  };

  function renderCard(judgementCalls?: ReadonlyMap<string, JudgementCall[]>) {
    const bundle: ReviewBundle = {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      generatedAt: '2026-09-11T10:00:00.000Z',
      meta: {
        repo: 'a/r',
        title: 't',
        prNumber: null,
        baseRefName: null,
        headRefName: null,
        authorLogin: null,
        description: null,
        stats: null,
      },
      review: { prTitle: 't', overviewSummary: { lede: '' }, chapters: [chapter] },
      files: {},
    };
    return render(
      <EmbeddedFileSource bundle={bundle}>
        <ChapterCard
          chapter={chapter}
          chapterIndex={1}
          {...(judgementCalls ? { judgementCalls } : {})}
        />
      </EmbeddedFileSource>,
    );
  }

  it('puts an anchored insight on its own file and nowhere else', () => {
    renderCard();
    const constants = screen.getByRole('figure', { name: 'Diff for src/constants.ts' });
    const pipeline = screen.getByRole('figure', { name: 'Diff for src/pipeline.ts' });

    expect(within(constants).getByText('Why the margin is 14 days')).toBeDefined();
    expect(within(pipeline).queryByText('Why the margin is 14 days')).toBeNull();
    expect(screen.getAllByText('Why the margin is 14 days')).toHaveLength(1);
  });

  it('leaves the orienting insight above the diffs, and counts only it under Insights', () => {
    const { container } = renderCard();
    const insightSection = screen.getByText('Insights').closest('header');
    expect(insightSection).not.toBeNull();
    // The count beside the "Insights" rule is the unanchored count, not both.
    expect(within(insightSection!).getByText('1')).toBeDefined();

    const orientation = screen.getByText('Orientation, before any code.');
    const firstFigure = container.querySelector('[role="figure"]');
    expect(
      orientation.compareDocumentPosition(firstFigure!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws the description as a lede over a Markdown body', () => {
    const { container } = renderCard();
    expect(screen.getByText('Late cancellations stop counting against a tech.')).toBeDefined();
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('draws a judgement call on its own file, above the insights anchored there', () => {
    const call: JudgementCall = {
      title: 'The margin is a business-rules constant',
      text: 'Fourteen days suits the current SLA; a shorter one makes this a config value.',
      filename: 'src/constants.ts',
      hunkIds: ['H0001'],
    };
    renderCard(new Map([['src/constants.ts', [call]]]));

    const constants = screen.getByRole('figure', { name: 'Diff for src/constants.ts' });
    const pipeline = screen.getByRole('figure', { name: 'Diff for src/pipeline.ts' });
    expect(within(constants).getByText(/Judgement call/)).toBeDefined();
    expect(within(pipeline).queryByText(/Judgement call/)).toBeNull();

    // Ahead of the insight anchored to the same file: the question is the only
    // thing on the page addressed to the reader.
    const question = within(constants).getByText(call.title);
    const insight = within(constants).getByText('Why the margin is 14 days');
    expect(
      question.compareDocumentPosition(insight) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws no judgement calls when the chapter owns none', () => {
    renderCard();
    expect(screen.queryByText(/Judgement call/)).toBeNull();
  });
});

describe('orderChunksTestsLast', () => {
  it('moves test files after non-test files, keeping relative order within each group', () => {
    const chunks = [
      chunk('src/domain/review/run.test.ts'),
      chunk('src/domain/review/run.server.ts'),
      chunk('src/domain/review/coverage.ts'),
      chunk('src/domain/review/coverage.test.ts'),
    ];

    expect(orderChunksTestsLast(chunks).map((c) => c.filename)).toEqual([
      'src/domain/review/run.server.ts',
      'src/domain/review/coverage.ts',
      'src/domain/review/run.test.ts',
      'src/domain/review/coverage.test.ts',
    ]);
  });

  it('recognises spec files, underscore-suffixed tests and __tests__ directories', () => {
    const chunks = [
      chunk('pkg/foo_test.go'),
      chunk('pkg/foo.go'),
      chunk('src/__tests__/widget.tsx'),
      chunk('src/widget.tsx'),
      chunk('src/widget.spec.js'),
    ];

    expect(orderChunksTestsLast(chunks).map((c) => c.filename)).toEqual([
      'pkg/foo.go',
      'src/widget.tsx',
      'pkg/foo_test.go',
      'src/__tests__/widget.tsx',
      'src/widget.spec.js',
    ]);
  });

  it('leaves an all-non-test or all-test list untouched', () => {
    const chunks = [chunk('a.ts'), chunk('b.ts')];
    expect(orderChunksTestsLast(chunks).map((c) => c.filename)).toEqual(['a.ts', 'b.ts']);
  });
});
