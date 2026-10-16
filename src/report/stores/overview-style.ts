import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { OverviewStyleSchema, type OverviewStyle, type OverviewStyles } from '@/review/narrative';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Which overview style the bodies are read in, for a review written in more
 * than one. The choice is the style rather than a per-review setting, so a
 * reader comparing styles keeps theirs from one review to the next; a review
 * not written in it opens on its first style, the one the engineer named first.
 *
 * Persisted raw under `er-overview-style`; nothing stored is no choice yet.
 */
export const OVERVIEW_STYLE_KEY = 'er-overview-style';

interface OverviewStyleState {
  chosen: OverviewStyle | null;
  choose: (style: OverviewStyle) => void;
}

const rawStorage = rawPreferenceStorage<Pick<OverviewStyleState, 'chosen'>>(
  (stored) => {
    const parsed = OverviewStyleSchema.safeParse(stored);
    return { chosen: parsed.success ? parsed.data : null };
  },
  (state) => state.chosen ?? '',
);

export const useOverviewStyleChoice = create<OverviewStyleState>()(
  persist(
    (set) => ({
      chosen: null,
      choose: (style) => set({ chosen: style }),
    }),
    {
      name: OVERVIEW_STYLE_KEY,
      storage: rawStorage,
      partialize: (state) => ({ chosen: state.chosen }),
    },
  ),
);

/** The reader's choice when the review was written in it, and otherwise the review's first style. */
export function shownStyle(styles: OverviewStyles, chosen: OverviewStyle | null): OverviewStyle {
  return chosen !== null && styles.includes(chosen) ? chosen : styles[0];
}

export function useOverviewStyle(styles: OverviewStyles): OverviewStyle {
  return shownStyle(
    styles,
    useOverviewStyleChoice((state) => state.chosen),
  );
}
