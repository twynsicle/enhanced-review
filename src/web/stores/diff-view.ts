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
