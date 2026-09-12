import { describe, expect, it, vi } from 'vitest';
import {
  RISK_SECTION_ID,
  SUMMARY_SECTION_ID,
  type NarrativeChapter,
  type ReviewRiskAssessment,
} from '@/domain/review/narrative';
import { HAND_BEFORE_AFTER } from '@/web/test/diagram-fixtures';
import { fireEvent, render, screen } from '@/web/test/render';
import { ChapterSidebar } from './chapter-sidebar';
import type { ReaderSection } from './sections';

const chapters: NarrativeChapter[] = [
  {
    id: 'ch1',
    title: 'Shape of the change',
    insights: [],
    diffChunks: [{ filename: 'src/app/page.tsx', language: 'typescript', hunks: [] }],
  },
  { id: 'ch2', title: 'Risks and follow-ups', insights: [], diffChunks: [] },
];

const sections: ReaderSection[] = [
  {
    id: SUMMARY_SECTION_ID,
    kind: 'summary',
    label: 'Summary',
    chapterNumber: null,
    hasDiagram: false,
  },
  { id: 'ch1', kind: 'chapter', label: 'Shape of the change', chapterNumber: 1, hasDiagram: false },
  {
    id: 'ch2',
    kind: 'chapter',
    label: 'Risks and follow-ups',
    chapterNumber: 2,
    hasDiagram: false,
  },
];

const riskAssessment: ReviewRiskAssessment = {
  score: 4,
  summary: 'High risk because data can be affected.',
  rationale: 'Persistence behavior changed.',
  factors: [],
};

/** The same list with a risk section, as `readerSections` builds it. */
const withRisk: ReaderSection[] = [
  sections[0] as ReaderSection,
  { id: RISK_SECTION_ID, kind: 'risk', label: 'Risk', chapterNumber: null, hasDiagram: false },
  ...sections.slice(1),
];

const noop = () => {};

describe('<ChapterSidebar />', () => {
  it('renders summary plus each chapter title', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="My PR"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getByText('Summary')).toBeDefined();
    expect(screen.queryByText('My PR')).toBeNull();
    expect(screen.getByText('Shape of the change')).toBeDefined();
    expect(screen.getByText('Risks and follow-ups')).toBeDefined();
  });

  it('marks the active item with aria-current', () => {
    const { rerender } = render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getByText('Summary').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(
      screen.getByText('Shape of the change').closest('button')?.getAttribute('aria-current'),
    ).toBeNull();

    rerender(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId="ch2"
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(
      screen.getByText('Risks and follow-ups').closest('button')?.getAttribute('aria-current'),
    ).toBe('true');
  });

  it('calls onSelect with the chapter id on click', () => {
    const onSelect = vi.fn();
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={onSelect}
        onSelectFile={noop}
      />,
    );
    fireEvent.click(screen.getByText('Risks and follow-ups'));
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('renders the risk score above the list and routes it to the risk section', () => {
    const onSelect = vi.fn();
    render(
      <ChapterSidebar
        sections={withRisk}
        chapters={chapters}
        activeId="ch1"
        reviewTitle="t"
        riskAssessment={riskAssessment}
        onSelect={onSelect}
        onSelectFile={noop}
      />,
    );

    // The card carries an accessible name; the bars carry the title.
    const riskCard = screen.getByLabelText(/Risk 4 of 5/);
    expect(riskCard).toBeDefined();
    expect(screen.getByTitle('Risk 4 of 5: High')).toBeDefined();
    fireEvent.click(riskCard);
    expect(onSelect).toHaveBeenCalledWith(RISK_SECTION_ID);
  });

  it('gives risk one entry, not two', () => {
    // The card is the risk section's row. A second row in the list below
    // would be a duplicate control for the same destination.
    render(
      <ChapterSidebar
        sections={withRisk}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        riskAssessment={riskAssessment}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getAllByText('Risk')).toHaveLength(1);
    expect(screen.queryByRole('listitem', { name: /Risk$/ })).toBeNull();
  });

  it('marks the sections that carry a diagram, and only those', () => {
    render(
      <ChapterSidebar
        sections={sections.map((section) =>
          section.id === 'ch2' ? { ...section, hasDiagram: true } : section,
        )}
        chapters={[
          chapters[0] as NarrativeChapter,
          { ...(chapters[1] as NarrativeChapter), diagram: HAND_BEFORE_AFTER },
        ]}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    const marks = screen.getAllByLabelText('has a diagram');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.closest('button')?.textContent).toContain('Risks and follow-ups');
  });

  it('falls back to the files chapters selected hunks from', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        onSelect={noop}
        onSelectFile={noop}
      />,
    );
    expect(screen.getByText('page.tsx')).toBeDefined();
    expect(screen.getByText('src/app/')).toBeDefined();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('clicking a file row routes via onSelectFile, not onSelect', () => {
    const onSelect = vi.fn();
    const onSelectFile = vi.fn();
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={[{ filename: 'src/app/page.tsx', status: 'modified', additions: 12, deletions: 3 }]}
        onSelect={onSelect}
        onSelectFile={onSelectFile}
      />,
    );

    // Basename on the main row, dirname underneath; the whole button is the
    // target. Stats appear twice (header totals + the row).
    fireEvent.click(screen.getByText('page.tsx'));
    expect(screen.getByText('src/app/')).toBeDefined();
    expect(screen.getAllByText('+12').length).toBe(2);
    expect(screen.getAllByText('-3').length).toBe(2);
    expect(onSelectFile).toHaveBeenCalledWith('src/app/page.tsx');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('lists a skipped file quietly, with the reason for anyone who asks', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={[
          {
            filename: 'package-lock.json',
            status: 'modified',
            additions: 40,
            deletions: 2,
            skipped: 'built-in',
          },
        ]}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    const row = screen.getByText('package-lock.json').closest('button')!;
    expect(row.hasAttribute('data-skipped')).toBe(true);
    expect(row.getAttribute('title')).toBe('Not reviewed: lockfile, bundle or snapshot');
    expect(row.textContent).toContain('Not reviewed: lockfile, bundle or snapshot');
  });

  it('marks the active file row with aria-current', () => {
    render(
      <ChapterSidebar
        sections={sections}
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        activeFile="src/app/page.tsx"
        reviewTitle="t"
        files={[{ filename: 'src/app/page.tsx', status: 'modified', additions: 1, deletions: 0 }]}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    expect(screen.getByText('page.tsx').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
  });
});
