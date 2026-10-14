import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether the code viewers paint comments at full strength or push them back.
 *
 * Dimmed rather than hidden: every line keeps its place and its number, so a
 * hunk that changes only comments still shows what it changed, and nothing
 * needs per-language comment ranges kept in step across a diff's two sides.
 *
 * Persisted raw under `er-dim-comments`, as the other reader preferences are.
 */
export type DimComments = 'normal' | 'dimmed';

export const DIM_COMMENTS_KEY = 'er-dim-comments';

interface DimCommentsState {
  comments: DimComments;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<DimCommentsState, 'comments'>>(
  (stored) => ({ comments: stored === 'dimmed' ? 'dimmed' : 'normal' }),
  (state) => state.comments,
);

export const useDimComments = create<DimCommentsState>()(
  persist(
    (set) => ({
      comments: 'normal',
      toggle: () =>
        set((state) => ({ comments: state.comments === 'dimmed' ? 'normal' : 'dimmed' })),
    }),
    {
      name: DIM_COMMENTS_KEY,
      storage: rawStorage,
      partialize: (state) => ({ comments: state.comments }),
    },
  ),
);
