import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@enhanced-review/review-types';
import { ChapterSidebar } from './chapter-sidebar';

const chapters: NarrativeChapter[] = [
  { id: 'ch1', title: 'Shape of the change', insights: [], diffChunks: [] },
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
    expect(screen.getByText('My PR')).toBeDefined();
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
      <ChapterSidebar
        chapters={chapters}
        activeId="ch2"
        reviewTitle="t"
        onSelect={() => {}}
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
      />,
    );
    fireEvent.click(screen.getByText('Risks and follow-ups'));
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });
});
