import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether every cited hunk is labelled with its id, its tier and which part
 * of a split hunk it is. For judging the review's tiers rather than reading
 * the review: a hunk tiered wrongly and one the CLI cut in the wrong place
 * look alike until both are shown.
 *
 * Persisted raw under `er-hunk-debug`, as the other reader preferences are.
 */
export type HunkDebug = 'off' | 'on';

export const HUNK_DEBUG_KEY = 'er-hunk-debug';

interface HunkDebugState {
  debug: HunkDebug;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<HunkDebugState, 'debug'>>(
  (stored) => ({ debug: stored === 'on' ? 'on' : 'off' }),
  (state) => state.debug,
);

export const useHunkDebug = create<HunkDebugState>()(
  persist(
    (set) => ({
      debug: 'off',
      toggle: () => set((state) => ({ debug: state.debug === 'on' ? 'off' : 'on' })),
    }),
    {
      name: HUNK_DEBUG_KEY,
      storage: rawStorage,
      partialize: (state) => ({ debug: state.debug }),
    },
  ),
);
