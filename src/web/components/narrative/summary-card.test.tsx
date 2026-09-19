import { describe, expect, it } from 'vitest';
import type { Finding } from '@/domain/review/findings';
import type { NarrativeReview } from '@/domain/review/narrative';
import type { ReviewMeta } from '@/domain/review/review-meta';
import { REAL_ARCHITECTURE } from '@/web/test/diagram-fixtures';
import { fireEvent, render, screen } from '@/web/test/render';
import type { AnchoredJudgementCall } from './judgement-calls';
import { SummaryCard } from './summary-card';

const baseMeta: ReviewMeta = {
  repo: 'acme/widgets',
  title: 'Add scheduled reviews',
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

function renderCard(
  overrides: Partial<NarrativeReview> = {},
  meta: Partial<ReviewMeta> = {},
  findings: Finding[] = [],
) {
  return render(
    <SummaryCard review={review(overrides)} meta={{ ...baseMeta, ...meta }} findings={findings} />,
  );
}

describe('<SummaryCard />', () => {
  it('shows the file and line counts whether or not there is a risk rating', () => {
    // These used to render only when there was no risk assessment to crowd
    // them out of the header. Risk has its own section now.
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

  it('shows a warning from validating the review, above what the reviewer said', () => {
    renderCard({}, {}, [
      {
        code: 'diff-truncated',
        severity: 'warning',
        message: 'Part of the change was never shown to the reviewer.',
      },
    ]);
    const notice = screen.getByText('Part of the change was never shown to the reviewer.');
    const summary = screen.getByText('Review summary');
    expect(notice.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws no notice for a review that found nothing to report', () => {
    renderCard();
    expect(screen.queryByText('What this review cost')).toBeNull();
  });

  it('draws no notice for notes, which cost the reader nothing', () => {
    renderCard({}, {}, [
      { code: 'chunks-merged', severity: 'note', message: 'Two chunks became one.' },
    ]);
    expect(screen.queryByText('What this review cost')).toBeNull();
    expect(screen.queryByText('Two chunks became one.')).toBeNull();
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
        findings={[]}
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
