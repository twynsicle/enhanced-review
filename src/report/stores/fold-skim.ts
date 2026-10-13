import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether a chapter's `skim` hunks are drawn open or folded behind one row, the
 * way its `mechanical` hunks always are.
 *
 * `shown` is the default because skim is still the story: wiring and setup a
 * reader needs to follow the change, which the model judged low-risk rather
 * than safe to pass over. A reader who trusts that judgement, or is short of
 * time, folds them and reads only what the review marked to be read.
 *
 * Persisted raw under `er-fold-skim`, as `er-diff-view` and `er-diff-wrap` are.
 */
export type FoldSkim = 'shown' | 'folded';

export const FOLD_SKIM_KEY = 'er-fold-skim';

interface FoldSkimState {
  skim: FoldSkim;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<FoldSkimState, 'skim'>>(
  (stored) => ({ skim: stored === 'folded' ? 'folded' : 'shown' }),
  (state) => state.skim,
);

export const useFoldSkim = create<FoldSkimState>()(
  persist(
    (set) => ({
      skim: 'shown',
      toggle: () => set((state) => ({ skim: state.skim === 'folded' ? 'shown' : 'folded' })),
    }),
    {
      name: FOLD_SKIM_KEY,
      storage: rawStorage,
      partialize: (state) => ({ skim: state.skim }),
    },
  ),
);
