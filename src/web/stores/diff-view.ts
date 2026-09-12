import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/web/stores/raw-preference';

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
 * Persisted raw under `er-diff-view`, the same way `er-layout` is. There is no
 * pre-paint script for it — nothing about the first paint depends on it,
 * because Monaco only mounts once hydrated — so the toggle rehydrates the
 * store after mount and the editors read it from there.
 */
export type DiffView = 'split' | 'unified';

export const DIFF_VIEW_KEY = 'er-diff-view';

/**
 * The narrowest column worth setting two revisions side by side in. Below it
 * the panes are too thin to read a line of code in either, so the diff is
 * stacked whatever the reader has chosen — and the choice stops being offered
 * rather than silently doing nothing.
 *
 * It is not a rare case: a 1248px window with the sidebar open leaves the
 * column at 881px, so an ordinary laptop is already under it.
 */
export const SIDE_BY_SIDE_MIN_WIDTH = 900;

interface DiffViewState {
  view: DiffView;
  /**
   * The reader's article column, measured — the width every diff in it gets.
   * `null` until something measures it, which is the honest answer before the
   * reader mounts and the one that leaves the preference usable.
   */
  columnWidth: number | null;
  toggle: () => void;
  setColumnWidth: (width: number | null) => void;
}

/**
 * Whether the column is too narrow to honour `split`. One measurement answers
 * it for the toggle's icon, the toggle's disabled state and the editors'
 * `renderSideBySide` alike, so those three cannot disagree about what is on
 * screen — which they would if each decided for itself.
 */
export const selectSpaceLimited = (state: DiffViewState): boolean =>
  state.columnWidth !== null && state.columnWidth < SIDE_BY_SIDE_MIN_WIDTH;

const rawStorage = rawPreferenceStorage<Pick<DiffViewState, 'view'>>(
  (stored) => ({ view: stored === 'unified' ? 'unified' : 'split' }),
  (state) => state.view,
);

export const useDiffView = create<DiffViewState>()(
  persist(
    (set) => ({
      view: 'split',
      columnWidth: null,
      toggle: () => set((state) => ({ view: state.view === 'split' ? 'unified' : 'split' })),
      setColumnWidth: (columnWidth) => set({ columnWidth }),
    }),
    {
      name: DIFF_VIEW_KEY,
      storage: rawStorage,
      partialize: (state) => ({ view: state.view }),
      skipHydration: true,
    },
  ),
);

/**
 * Rehydrate from storage. Called from the toggle's mount effect, which runs
 * before the reader's own effects — so the stored view is in place by the time
 * `useHydrated` flips and the first editor mounts, and nothing renders split
 * only to flip to unified.
 */
export function bindDiffView(): void {
  void useDiffView.persist.rehydrate();
}
