import { describe, expect, it } from 'vitest';
import type { CitedHunk, NarrativeChapter, NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { REAL_ARCHITECTURE } from '@/report/test/diagram-fixtures';
import { fireEvent, render, screen, within } from '@/report/test/render';
import type { AnchoredJudgementCall } from './judgement-calls';
import { SummaryCard } from './summary-card';

const baseMeta: ReviewMeta = {
  repo: 'acme/widgets',
  kind: 'pr',
  title: 'Add scheduled reviews',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  prNumber: 7,
  baseRefName: null,
  headRefName: null,
  authorLogin: 'someone',
  description: null,
  stats: null,
};

function review(overrides: Partial<NarrativeReview> = {}): NarrativeReview {
  return {
    prTitle: 'Add scheduled reviews',
    overviewSummary: { lede: 'The scheduler runs reviews on a cadence.' },
    chapters: [],
    files: [{ filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 4 }],
    ...overrides,
  };
}

function renderCard(overrides: Partial<NarrativeReview> = {}, meta: Partial<ReviewMeta> = {}) {
  return render(
    <SummaryCard
      review={review(overrides)}
      meta={{ ...baseMeta, ...meta }}
      onSelectChapter={() => {}}
    />,
  );
}

describe('<SummaryCard />', () => {
  it('shows the file and line counts whether or not there is a risk rating', () => {
    renderCard({ riskAssessment: { score: 4, summary: 'High', rationale: '', factors: [] } });
    expect(screen.getByText('1 file')).toBeDefined();
    expect(screen.getByText('+10')).toBeDefined();
    expect(screen.getByText('−4')).toBeDefined();
  });

  it('does not render the risk assessment itself', () => {
    renderCard({
      riskAssessment: { score: 4, summary: 'Data loss is possible', rationale: '', factors: [] },
    });
    expect(screen.queryByText('Data loss is possible')).toBeNull();
  });

  it('draws the written summary above the overview diagram', () => {
    const { container } = renderCard({ overviewDiagram: REAL_ARCHITECTURE });
    const figure = container.querySelector('figure');
    const summary = screen.getByText('Review summary');
    expect(figure).not.toBeNull();
    // `compareDocumentPosition` reads DOM order: the summary comes first.
    expect(
      summary.compareDocumentPosition(figure as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the author's description collapsed until asked", () => {
    renderCard({}, { description: 'Original PR body text.' });
    const toggle = screen.getByRole('button', { name: /description/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Original PR body text.')).toBeDefined();
  });

  it('says nothing about a description there is none of', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /description/i })).toBeNull();
  });

  it('shows the repository, PR number, refs and author from the meta', () => {
    renderCard({}, { baseRefName: 'main', headRefName: 'feat/scheduler' });
    expect(screen.getByText('acme/widgets')).toBeDefined();
    expect(screen.getByText('PR #7')).toBeDefined();
    expect(screen.getByText('feat/scheduler')).toBeDefined();
    expect(screen.getByText('@someone')).toBeDefined();
  });

  it('leaves out what a local review of staged changes does not have', () => {
    // No PR, no author login: the header shows only what it knows.
    renderCard({}, { prNumber: null, authorLogin: null });
    expect(screen.queryByText(/PR #/)).toBeNull();
    expect(screen.queryByText(/^@/)).toBeNull();
    expect(screen.getByText('acme/widgets')).toBeDefined();
  });

  it("uses the meta's title when the review has none", () => {
    renderCard({ prTitle: '' }, { title: 'feat/scheduler' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('feat/scheduler');
  });

  it('falls back to the meta stats for a review with no files list', () => {
    renderCard({ files: [] }, { stats: { changedFiles: 3, additions: 40, deletions: 2 } });
    expect(screen.getByText('3 files')).toBeDefined();
    expect(screen.getByText('+40')).toBeDefined();
  });
});

describe('<SummaryCard /> and the judgement calls', () => {
  const anchored: AnchoredJudgementCall[] = [
    {
      call: {
        title: 'Hourly cadence offered to every repo',
        text: 'Cheap if few choose it, 24x the work if most do.',
        filename: 'src/scheduler/cadence.ts',
        hunkIds: ['H0003'],
      },
      chapterId: 'cadence-table',
    },
  ];

  function renderIndex(onSelectChapter: (chapterId: string) => void) {
    return render(
      <SummaryCard
        review={review()}
        meta={baseMeta}
        judgementCalls={anchored}
        onSelectChapter={onSelectChapter}
      />,
    );
  }

  it('lists each title with the file it sits on', () => {
    renderIndex(() => {});
    expect(screen.getByText('Judgement calls')).toBeDefined();
    expect(screen.getByText('Hourly cadence offered to every repo')).toBeDefined();
    expect(screen.getByText('src/scheduler/cadence.ts')).toBeDefined();
  });

  it('lists the title only, leaving the question itself beside its code', () => {
    renderIndex(() => {});
    expect(screen.queryByText('Cheap if few choose it, 24x the work if most do.')).toBeNull();
  });

  it('sends the reader to the chapter that draws the question', () => {
    const selected: string[] = [];
    renderIndex((chapterId) => selected.push(chapterId));
    fireEvent.click(screen.getByRole('button', { name: 'Hourly cadence offered to every repo' }));
    expect(selected).toEqual(['cadence-table']);
  });

  it('draws nothing at all for a review that asked nothing', () => {
    renderCard();
    expect(screen.queryByText('Judgement calls')).toBeNull();
  });
});

const planHunk = (lines: number, tier: CitedHunk['tier']): CitedHunk => ({
  id: `H${String(lines)}`,
  fileOrder: 0,
  original: { startLine: 1, lineCount: 0 },
  modified: { startLine: 1, lineCount: lines },
  changedLines: lines,
  tier,
});

const planChapter = (id: string, title: string, cited: CitedHunk): NarrativeChapter => ({
  id,
  title,
  headline: 'A headline.',
  insights: [],
  diffChunks: [{ filename: `src/${id}.ts`, language: 'typescript', hunks: [cited] }],
});

/** The plan row a name heads. */
const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('<SummaryCard /> and the reading plan', () => {
  // 100 lines read is 240s and 100 skimmed 60s; the overview's seven words
  // are 2s, and each plan is rounded up once.
  const chapters = [
    planChapter('core', 'The due check', planHunk(100, 'read')),
    planChapter('support', 'Fixtures', planHunk(100, 'skim')),
    planChapter('wiring', 'Wiring', planHunk(100, 'skim')),
  ];

  function renderPlan(
    readingPlan: NarrativeReview['readingPlan'],
    onSelectChapter: (chapterId: string) => void = () => {},
  ) {
    return render(
      <SummaryCard
        review={review({ chapters, ...(readingPlan ? { readingPlan } : {}) })}
        meta={baseMeta}
        onSelectChapter={onSelectChapter}
      />,
    );
  }

  it('gives each plan its time, the overview included in every one', () => {
    renderPlan({ brief: ['core'], standard: ['core', 'support'] });
    expect(screen.getByText('Reading plan')).toBeDefined();
    expect(within(rowOf('Brief')).getByText('~5 min')).toBeDefined();
    expect(within(rowOf('Standard')).getByText('~6 min')).toBeDefined();
    expect(within(rowOf('Full')).getByText('~7 min')).toBeDefined();
  });

  it('lists under each longer plan only the chapters it adds, numbered as the sidebar numbers them', () => {
    renderPlan({ brief: ['core'], standard: ['core', 'support'] });
    const names = (row: string) =>
      within(rowOf(row))
        .queryAllByRole('button')
        .map((button) => button.textContent);
    expect(names('Brief')).toEqual(['01 The due check']);
    expect(names('Standard')).toEqual(['02 Fixtures']);
    expect(names('Full')).toEqual(['03 Wiring']);
  });

  it('says so when a plan adds nothing to the one before', () => {
    renderPlan({ brief: ['core'], standard: ['core', 'support', 'wiring'] });
    expect(within(rowOf('Full')).getByText('The standard read, and nothing more.')).toBeDefined();
  });

  it('sends the reader to the chapter a link names', () => {
    const selected: string[] = [];
    renderPlan({ brief: ['core'], standard: ['core', 'support'] }, (id) => selected.push(id));
    fireEvent.click(screen.getByRole('button', { name: '02 Fixtures' }));
    expect(selected).toEqual(['support']);
  });

  it('draws nothing for a review that carries no plan', () => {
    renderPlan(undefined);
    expect(screen.queryByText('Reading plan')).toBeNull();
  });
});
