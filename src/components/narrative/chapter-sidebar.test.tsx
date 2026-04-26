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

describe('<ChapterSidebar />', () => {
  it('renders summary plus each chapter title', () => {
    render(
      <ChapterSidebar
        chapters={chapters}
        activeId={SUMMARY_SECTION_ID}
        reviewTitle="My PR"
        onSelect={() => {}}
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
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Summary').closest('button')?.getAttribute('aria-current')).toBe(
      'true',
    );
    expect(
      screen.getByText('Shape of the change').closest('button')?.getAttribute('aria-current'),
    ).toBeNull();

    rerender(
      <ChapterSidebar chapters={chapters} activeId="ch2" reviewTitle="t" onSelect={() => {}} />,
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
      />,
    );

    expect(screen.getByText('Review risk')).toBeDefined();
    expect(screen.getByTitle('Risk 4 of 5: High')).toBeDefined();
    fireEvent.click(screen.getByText('Review risk'));
    expect(onSelect).toHaveBeenCalledWith(SUMMARY_SECTION_ID);
  });

  it('renders changed files and routes mapped files to their chapter', () => {
    const onSelect = vi.fn();
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
      />,
    );

    fireEvent.click(screen.getByText('src/app/page.tsx'));
    expect(screen.getByText('+12')).toBeDefined();
    expect(screen.getByText('-3')).toBeDefined();
    expect(onSelect).toHaveBeenCalledWith('ch1');
  });
});
