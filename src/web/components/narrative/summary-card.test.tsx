import { describe, expect, it } from 'vitest';
import type { NarrativeReview } from '@/domain/review/narrative';
import type { ReviewTarget } from '@/domain/review/target';
import { REAL_ARCHITECTURE } from '@/web/test/diagram-fixtures';
import { fireEvent, render, screen } from '@/web/test/render';
import { SummaryCard } from './summary-card';

const target: ReviewTarget = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  title: 'Add scheduled reviews',
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
};

function review(overrides: Partial<NarrativeReview> = {}): NarrativeReview {
  return {
    prTitle: 'Add scheduled reviews',
    overviewSummary: 'The scheduler runs reviews on a cadence.',
    chapters: [],
    files: [{ filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 4 }],
    ...overrides,
  };
}

function renderCard(overrides: Partial<NarrativeReview> = {}, body?: string) {
  return render(
    <SummaryCard
      review={review(overrides)}
      target={target}
      pullMetadata={body === undefined ? null : ({ body } as never)}
      byline={{ author: 'someone' }}
    />,
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

  it('draws the overview diagram above the written summary', () => {
    const { container } = renderCard({ overviewDiagram: REAL_ARCHITECTURE });
    const figure = container.querySelector('figure');
    const summary = screen.getByText('Review summary');
    expect(figure).not.toBeNull();
    // `compareDocumentPosition` reads DOM order: the diagram comes first.
    expect(
      (figure as Element).compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the author's description collapsed until asked", () => {
    renderCard({}, 'Original PR body text.');
    const toggle = screen.getByRole('button', { name: /description/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Original PR body text.')).toBeDefined();
  });

  it('says nothing about a description GitHub did not answer for', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: /description/i })).toBeNull();
  });
});
