import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * How far skim marks push a skim hunk back, as a percentage: the share of the
 * text's strength taken away, and near enough the share of the diff's band
 * washed out behind it. Whether to mark skim hunks at all is `skim-marks.ts`;
 * this is only how hard, since how faint is too faint depends on the screen,
 * the scheme and the reader.
 *
 * Persisted raw under `er-skim-fade` and applied as `--review-skim-fade` on
 * `<html>`, as the sidebar's width is: the editors' decoration classes read
 * the variable, so a change restyles every editor without re-rendering one.
 * A number, so a stored value is clamped to the slider's range rather than
 * matched.
 */
export const SKIM_FADE_KEY = 'er-skim-fade';

export const SKIM_FADES = { min: 20, max: 75, step: 5, default: 60 } as const;

export function clampSkimFade(fade: number): number {
  return Math.round(Math.min(SKIM_FADES.max, Math.max(SKIM_FADES.min, fade)));
}

interface SkimFadeState {
  fade: number;
  setFade: (fade: number) => void;
}

function storedFade(stored: string | null): number {
  const parsed = Number(stored);
  // `Number(null)` and `Number('')` are both 0, which no fade is.
  return Number.isFinite(parsed) && parsed > 0 ? clampSkimFade(parsed) : SKIM_FADES.default;
}

const rawStorage = rawPreferenceStorage<Pick<SkimFadeState, 'fade'>>(
  (stored) => ({ fade: storedFade(stored) }),
  (state) => String(state.fade),
);

export const useSkimFade = create<SkimFadeState>()(
  persist(
    (set) => ({
      fade: SKIM_FADES.default,
      setFade: (fade) => set({ fade: clampSkimFade(fade) }),
    }),
    {
      name: SKIM_FADE_KEY,
      storage: rawStorage,
      partialize: (state) => ({ fade: state.fade }),
    },
  ),
);

function applySkimFade(fade: number): void {
  document.documentElement.style.setProperty('--review-skim-fade', String(fade / 100));
}

/** Apply the CSS variable and follow later changes. Returns the unsubscribe. */
export function followSkimFade(): () => void {
  applySkimFade(useSkimFade.getState().fade);
  return useSkimFade.subscribe((state) => applySkimFade(state.fade));
}
