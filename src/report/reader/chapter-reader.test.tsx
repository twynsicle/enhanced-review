import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/review/bundle';
import {
  SUMMARY_SECTION_ID,
  type NarrativeChapter,
  type NarrativeReview,
} from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { SIDEBAR_WIDTH_KEY, useSidebarWidth } from '@/report/stores/sidebar-width';
import { act, fireEvent, render, screen, userEvent } from '@/report/test/render';
import { SIDEBAR_WIDTHS } from '@/report/theme/tokens';
import { ChapterReader, KEYBOARD_RESIZE_STEP } from './chapter-reader';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  loader: { config: () => {}, init: () => Promise.resolve({ editor: { defineTheme: () => {} } }) },
}));

const meta: ReviewMeta = {
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

const review: NarrativeReview = {
  prTitle: 'Add scheduled reviews',
  overviewStyles: ['narrative'],
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
      chapters: [
        {
          id: 'ch1',
          title: 'The scheduler',
          headline: 'The scheduler runs reviews on a cadence.',
          insights: [],
          diffChunks: [],
        },
      ],
    };
    const handle = renderReader(withChapter);

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    // Two presses, two steps: the second is the one that used to be lost.
    const step = SIDEBAR_WIDTHS.default + 2 * KEYBOARD_RESIZE_STEP;
    expect(useSidebarWidth.getState().width).toBe(step);
    expect(handle).toHaveAttribute('aria-valuenow', String(step));

    // Still on the summary: the chapter's heading is drawn only while it is open.
    expect(
      screen.queryByRole('heading', { name: 'The scheduler runs reviews on a cadence.' }),
    ).toBeNull();
  });
});

async function show(chapterId: string): Promise<void> {
  await act(async () => {
    window.location.hash = `#/?ch=${chapterId}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

/** Each chapter shows the same file in the same place: a read hunk, then a skim one. */
function chapter(id: string, title: string): NarrativeChapter {
  return {
    id,
    title,
    headline: `What ${title} changes.`,
    insights: [],
    diffChunks: [
      {
        filename: 'src/a.ts',
        language: 'typescript',
        hunks: [
          {
            id: `${id}-1`,
            fileOrder: 1,
            original: { startLine: 1, lineCount: 10 },
            modified: { startLine: 1, lineCount: 10 },
            changedLines: 10,
            tier: 'read',
          },
          {
            id: `${id}-2`,
            fileOrder: 2,
            original: { startLine: 21, lineCount: 10 },
            modified: { startLine: 21, lineCount: 10 },
            changedLines: 10,
            tier: 'skim',
          },
        ],
      },
    ],
  };
}

describe('a chapter change', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${String(i + 1)}`).join('\n');
  const twoChapters: NarrativeReview = {
    ...review,
    chapters: [chapter('ch1', 'First look'), chapter('ch2', 'Second look')],
  };
  const side = { kind: 'content', content: lines } as const;
  const bundle: ReviewBundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: '2026-09-11T10:00:00.000Z',
    meta,
    review: twoChapters,
    files: { 'src/a.ts': { base: side, head: side } },
  };
  beforeEach(() => {
    window.location.hash = '#/?ch=ch1';
    render(
      <EmbeddedFileSource bundle={bundle}>
        <ChapterReader review={twoChapters} meta={meta} initialActiveId="ch1" />
      </EmbeddedFileSource>,
    );
  });

  it('shows the next chapter’s changes, not the full file the last one was showing', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Show full file' }));
    expect(screen.getByRole('button', { name: 'Show changes only' })).toBeDefined();

    await show('ch2');

    expect(screen.getByRole('heading', { name: 'What Second look changes.' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Show full file' })).toBeDefined();
  });
});
