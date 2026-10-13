import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether a diff draws a skim hunk like any other, or marks it: its lines
 * faded, and a label at the right edge of the lines saying why it may be
 * skimmed — a proven move or whitespace change, else the review's own reason.
 *
 * `plain` is the default. A fade with no reason the reader has asked for reads
 * as a rendering fault, and a reviewer who has not yet decided to trust the
 * review's tiers should see every line at the same strength.
 *
 * Persisted raw under `er-skim-marks`, as the other reader preferences are.
 */
export type SkimMarks = 'plain' | 'marked';

export const SKIM_MARKS_KEY = 'er-skim-marks';

interface SkimMarksState {
  marks: SkimMarks;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<SkimMarksState, 'marks'>>(
  (stored) => ({ marks: stored === 'marked' ? 'marked' : 'plain' }),
  (state) => state.marks,
);

export const useSkimMarks = create<SkimMarksState>()(
  persist(
    (set) => ({
      marks: 'plain',
      toggle: () => set((state) => ({ marks: state.marks === 'marked' ? 'plain' : 'marked' })),
    }),
    {
      name: SKIM_MARKS_KEY,
      storage: rawStorage,
      partialize: (state) => ({ marks: state.marks }),
    },
  ),
);
