import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@enhanced-review/review-types';
import { ChapterSidebar } from './chapter-sidebar';

const chapters: NarrativeChapter[] = [
  {
    id: 'ch1',
    title: 'Shape of the change',
    insights: [],
    diffChunks: [{ filename: 'src/app/page.tsx', language: 'typescript', hunks: [] }],
  },
  { id: 'ch2', title: 'Risks and follow-ups', insights: [], diffChunks: [] },
];

const noop = () => {};

describe('<ChapterSidebar />', () => {
  it('renders summary plus each chapter title', () => {
    render(
      <ChapterSidebar
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

  it('renders the risk score above chapters and routes it to summary', () => {
    const onSelect = vi.fn();
    render(
      <ChapterSidebar
        chapters={chapters}
        activeId="ch1"
        reviewTitle="t"
        riskAssessment={{
          score: 4,
          summary: 'High risk because data can be affected.',
          rationale: 'Persistence behavior changed.',
          factors: [],
        }}
        onSelect={onSelect}
        onSelectFile={noop}
      />,
    );

    // The card surfaces the "Risk" eyebrow + a score caption ("4/5 · High");
    // the label component carries an accessible title for screen readers.
    const riskCard = screen.getByLabelText(/Risk 4 of 5/);
    expect(riskCard).toBeDefined();
    expect(screen.getByTitle('Risk 4 of 5: High')).toBeDefined();
    fireEvent.click(riskCard);
    expect(onSelect).toHaveBeenCalledWith(SUMMARY_SECTION_ID);
  });

  it('clicking a file row routes via onSelectFile, not onSelect', () => {
    const onSelect = vi.fn();
    const onSelectFile = vi.fn();
    render(
      <ChapterSidebar
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="t"
        files={[
          {
            filename: 'src/app/page.tsx',
            status: 'modified',
            additions: 12,
            deletions: 3,
          },
        ]}
        onSelect={onSelect}
        onSelectFile={onSelectFile}
      />,
    );

    // Filename is split: basename ("page.tsx") on the main row,
    // dirname ("src/app/") underneath. Click the basename — the whole
    // button is the click target. Stats appear twice (Files header
    // totals + per-row stats) when there's a single file with stats.
    fireEvent.click(screen.getByText('page.tsx'));
    expect(screen.getByText('src/app/')).toBeDefined();
    expect(screen.getAllByText('+12').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('-3').length).toBeGreaterThanOrEqual(1);
    expect(onSelectFile).toHaveBeenCalledWith('src/app/page.tsx');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marks the active file row with aria-current', () => {
    render(
      <ChapterSidebar
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        activeFile="src/app/page.tsx"
        reviewTitle="t"
        files={[
          {
            filename: 'src/app/page.tsx',
            status: 'modified',
            additions: 1,
            deletions: 0,
          },
        ]}
        onSelect={noop}
        onSelectFile={noop}
      />,
    );

    expect(screen.getByText('page.tsx').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
  });
});
