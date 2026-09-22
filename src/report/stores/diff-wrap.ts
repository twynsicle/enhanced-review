import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether a diff soft-wraps a line too long for its column, or lets it run off
 * the right edge behind a horizontal scrollbar.
 *
 * `off` is the default because wrapping buys every line at the price of the
 * thing that makes a diff scannable: one screen row per source line, so the two
 * sides stay level and the eye can run straight down a column. Which of those
 * is worth more depends on the file in front of the reader — a wall of long
 * string literals wants wrapping, a dense refactor does not — so this is a
 * choice rather than a verdict, and the unchosen state is the one the reader
 * already has.
 *
 * The two stops are spelled the way Monaco spells them, so the stored word is
 * the value handed to the editor rather than a translation of it.
 *
 * Persisted raw under `er-diff-wrap`, as `er-diff-view` and `er-layout` are.
 */
export type DiffWrap = 'off' | 'on';

export const DIFF_WRAP_KEY = 'er-diff-wrap';

interface DiffWrapState {
  wrap: DiffWrap;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<DiffWrapState, 'wrap'>>(
  (stored) => ({ wrap: stored === 'on' ? 'on' : 'off' }),
  (state) => state.wrap,
);

export const useDiffWrap = create<DiffWrapState>()(
  persist(
    (set) => ({
      wrap: 'off',
      toggle: () => set((state) => ({ wrap: state.wrap === 'on' ? 'off' : 'on' })),
    }),
    {
      name: DIFF_WRAP_KEY,
      storage: rawStorage,
      partialize: (state) => ({ wrap: state.wrap }),
    },
  ),
);
