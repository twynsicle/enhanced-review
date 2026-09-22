import { beforeEach, describe, expect, it } from 'vitest';
import { SUMMARY_SECTION_ID, type NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { SIDEBAR_WIDTH_KEY, useSidebarWidth } from '@/report/stores/sidebar-width';
import { fireEvent, render, screen } from '@/report/test/render';
import { SIDEBAR_WIDTHS } from '@/report/theme/tokens';
import { ChapterReader, KEYBOARD_RESIZE_STEP } from './chapter-reader';

const meta: ReviewMeta = {
  repo: 'acme/widgets',
  title: 'Add scheduled reviews',
  prNumber: 7,
  baseRefName: null,
  headRefName: null,
  authorLogin: 'someone',
  description: null,
  stats: null,
};

const review: NarrativeReview = {
  prTitle: 'Add scheduled reviews',
  overviewSummary: { lede: 'The scheduler runs reviews on a cadence.' },
  chapters: [],
  files: [{ filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 4 }],
};

function renderReader(withReview: NarrativeReview = review) {
  render(<ChapterReader review={withReview} meta={meta} initialActiveId={SUMMARY_SECTION_ID} />);
  return screen.getByRole('separator', { name: 'Resize review navigation' });
}

const painted = (): string =>
  document.documentElement.style.getPropertyValue('--review-sidebar-width');

describe('the sidebar resize handle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSidebarWidth.setState({ width: SIDEBAR_WIDTHS.default });
    document.documentElement.style.removeProperty('--review-sidebar-width');
  });

  it('paints while the pointer moves and commits once it is released', () => {
    const handle = renderReader();
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 340 });

    // Mid-drag the variable has moved but the stored preference has not: a
    // width still under the pointer has not earned a write per frame.
    expect(painted()).toBe(`${SIDEBAR_WIDTHS.default + 40}px`);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(SIDEBAR_WIDTHS.default));

    fireEvent.pointerUp(window, { clientX: 340 });
    expect(useSidebarWidth.getState().width).toBe(SIDEBAR_WIDTHS.default + 40);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(
      String(SIDEBAR_WIDTHS.default + 40),
    );
  });

  /*
   * A browser that takes a touch over for panning ends the gesture with
   * `pointercancel` and no `pointerup` at all. Left unhandled that stranded the
   * column at a width nothing had stored, with the move handler still attached
   * — so it went on tracking a pointer with no button down.
   */
  it('ends the drag when the browser cancels the gesture', () => {
    const handle = renderReader();
    fireEvent.pointerDown(handle, { clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 340 });
    fireEvent.pointerCancel(window, { clientX: 340 });

    const committed = SIDEBAR_WIDTHS.default + 40;
    expect(useSidebarWidth.getState().width).toBe(committed);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(committed));
    expect(handle).toHaveAttribute('aria-valuenow', String(committed));

    // And the handler is gone: a stray move with no button down moves nothing.
    fireEvent.pointerMove(window, { clientX: 600 });
    expect(painted()).toBe(`${committed}px`);
  });

  /*
   * The arrows are a separator's own interaction, and the reader binds them on
   * `document` to walk its sections. One press used to do both: widen the
   * column and navigate away, which moved focus off the handle and left the
   * next press with nothing to resize.
   */
  it('resizes on the arrow keys without walking to the next section', () => {
    const withChapter: NarrativeReview = {
      ...review,
      chapters: [{ id: 'ch1', title: 'The scheduler', insights: [], diffChunks: [] }],
    };
    const handle = renderReader(withChapter);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    // Two presses, two steps: the second is the one that used to be lost.
    const step = SIDEBAR_WIDTHS.default + 2 * KEYBOARD_RESIZE_STEP;
    expect(useSidebarWidth.getState().width).toBe(step);
    expect(handle).toHaveAttribute('aria-valuenow', String(step));

    // Still on the summary. The chapter's title appears in the sidebar either
    // way, so this asks for the heading, which only the open section renders.
    expect(screen.queryByRole('heading', { name: 'The scheduler' })).toBeNull();
  });
});
