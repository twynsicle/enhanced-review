import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Rating, RatingsFile } from './sheet-data';

/**
 * The user's own ratings of the sheet's overviews, which the eval's judges
 * are checked against. Kept in the browser under one key for every sheet,
 * each rating by its sweep's stamp, branch and sample, so a sheet built again
 * for the same sweep, or one pairing it with another, shows them again.
 */
export const SHEET_RATINGS_KEY = 'er-sheet-ratings';

export interface RatedOverview {
  stamp: string;
  branch: string;
  sample: number;
  rating: Rating;
}

export const ratingKey = (stamp: string, branch: string, sample: number) =>
  `${stamp}/${branch}/${String(sample)}`;

interface SheetRatingsState {
  ratings: Record<string, RatedOverview>;
  /** A rating, or null to take one back. */
  rate: (overview: Omit<RatedOverview, 'rating'>, rating: Rating | null) => void;
}

export const useSheetRatings = create<SheetRatingsState>()(
  persist(
    (set) => ({
      ratings: {},
      rate: (overview, rating) =>
        set((state) => {
          const key = ratingKey(overview.stamp, overview.branch, overview.sample);
          const { [key]: _taken, ...rest } = state.ratings;
          return { ratings: rating === null ? rest : { ...rest, [key]: { ...overview, rating } } };
        }),
    }),
    { name: SHEET_RATINGS_KEY, partialize: (state) => ({ ratings: state.ratings }) },
  ),
);

/** The ratings of the sweeps this sheet shows, as `agree` reads them from ratings.json. */
export function ratingsFile(
  ratings: Record<string, RatedOverview>,
  stamps: readonly string[],
): RatingsFile {
  return {
    ratings: Object.values(ratings)
      .filter((item) => stamps.includes(item.stamp))
      .toSorted((a, b) =>
        ratingKey(a.stamp, a.branch, a.sample).localeCompare(
          ratingKey(b.stamp, b.branch, b.sample),
        ),
      ),
  };
}
