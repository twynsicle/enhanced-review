import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * How the reader draws a diff: `split` sets the two revisions side by side,
 * `unified` stacks them into one column.
 *
 * Split is the default, and it is the reason the reader fills the window —
 * two panes of code need twice the room, and halving a 92rem page was what had
 * reviewers scrolling sideways through every hunk. Unified is what the narrower
 * width stop is for: one column of code reads fine at 110rem, so the two
 * preferences are usually turned together.
 *
 * Persisted raw under `er-diff-view`, the same way `er-layout` is.
 */
export type DiffView = 'split' | 'unified';

export const DIFF_VIEW_KEY = 'er-diff-view';

/**
 * The narrowest column worth setting two revisions side by side in, inclusive:
 * 900px gets two panes, 899px does not. Below it the panes are too thin to read
 * a line of code in either, so the diff is stacked whatever the reader has
 * chosen — and the choice stops being offered rather than silently doing
 * nothing.
 *
 * Monaco decides the same thing for itself from
 * `renderSideBySideInlineBreakpoint`, and its comparison is inclusive the other
 * way (`width <= breakpoint` goes inline), so `inline-diff-chunk.tsx` hands it
 * this value minus one. Change the boundary here and that stays in step; change
 * only one of them and the toggle starts claiming a view the editors are not
 * drawing at exactly one width.
 *
 * It is not a rare case: a 1248px window with the sidebar open leaves the
 * column at 881px, so an ordinary laptop is already under it.
 */
export const SIDE_BY_SIDE_MIN_WIDTH = 900;

/** The stored preference, and nothing else — see `useReaderColumn` below. */
interface DiffViewState {
  view: DiffView;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<DiffViewState, 'view'>>(
  (stored) => ({ view: stored === 'unified' ? 'unified' : 'split' }),
  (state) => state.view,
);

export const useDiffView = create<DiffViewState>()(
  persist(
    (set) => ({
      view: 'split',
      toggle: () => set((state) => ({ view: state.view === 'split' ? 'unified' : 'split' })),
    }),
    {
      name: DIFF_VIEW_KEY,
      storage: rawStorage,
      partialize: (state) => ({ view: state.view }),
    },
  ),
);

interface ReaderColumnState {
  /**
   * The reader's article column, measured — the width every diff in it gets.
   * `null` until something measures it, which is the honest answer before the
   * reader mounts and the one that leaves the preference usable.
   */
  columnWidth: number | null;
  setColumnWidth: (width: number | null) => void;
}

/**
 * The measured column, kept in a store of its own rather than as one more
 * field on `useDiffView`, so that measuring can never reach localStorage.
 *
 * `persist` wraps the creator's `set` and writes the partialized slice after
 * every call, without first comparing it to what is already stored. The width
 * is republished by a ResizeObserver (`chapter-reader.tsx`) roughly once per
 * animation frame for as long as the sidebar handle is dragged or the window
 * resized, so while it lived on the persisted store every frame of a drag cost
 * a synchronous `localStorage.setItem` — each one writing back the same
 * unchanged word. Splitting the stores keeps the rule legible instead of
 * relying on a guard inside the setter: a preference is persisted, a
 * measurement is not, and the two can no longer be confused for each other.
 *
 * Both live in this module because the threshold below is the only thing
 * either of them is for, and a reader of one needs the other in front of them.
 */
export const useReaderColumn = create<ReaderColumnState>((set) => ({
  columnWidth: null,
  setColumnWidth: (columnWidth) => set({ columnWidth }),
}));

/**
 * Whether the column is too narrow to honour `split` — true strictly below
 * `SIDE_BY_SIDE_MIN_WIDTH`, so a column of exactly 900px is still wide enough.
 * One measurement answers it for the toggle's icon, the toggle's disabled state
 * and the editors' `renderSideBySide` alike, so those three cannot disagree
 * about what is on screen — which they would if each decided for itself.
 *
 * An unmeasured column (`null`) is not a narrow one: the preference stands
 * until something has a width to offer.
 */
export const selectSpaceLimited = (state: ReaderColumnState): boolean =>
  state.columnWidth !== null && state.columnWidth < SIDE_BY_SIDE_MIN_WIDTH;
