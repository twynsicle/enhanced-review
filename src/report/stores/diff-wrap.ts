import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether a diff soft-wraps a line too long for its column, or lets it run off
 * the right edge behind a horizontal scrollbar.
 *
 * `on` is the default. A side-by-side diff halves the column, so long lines
 * are common, and a change at the end of one sits behind a scrollbar the
 * reader has no reason to touch. Wrapping costs the one screen row per source
 * line that keeps the two sides level, which a dense refactor may want back,
 * so this stays a choice.
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
  (stored) => ({ wrap: stored === 'off' ? 'off' : 'on' }),
  (state) => state.wrap,
);

export const useDiffWrap = create<DiffWrapState>()(
  persist(
    (set) => ({
      wrap: 'on',
      toggle: () => set((state) => ({ wrap: state.wrap === 'on' ? 'off' : 'on' })),
    }),
    {
      name: DIFF_WRAP_KEY,
      storage: rawStorage,
      partialize: (state) => ({ wrap: state.wrap }),
    },
  ),
);
