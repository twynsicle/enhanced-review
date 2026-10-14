import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

export interface FadeRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

interface FadeState {
  fade: number;
  setFade: (fade: number) => void;
}

/**
 * A fade the reader sets with a slider: a percentage of strength taken away,
 * persisted raw as one number and painted as a fraction in a CSS variable on
 * `<html>`, as the sidebar's width is. The editors' classes read the variable,
 * so a change restyles every editor without re-rendering one. A number, so a
 * stored value is clamped to the slider's range rather than matched.
 *
 * `preview` paints a value without storing it, for a drag: storage is for the
 * value the reader settles on, not each step on the way there.
 */
export function createFadePreference({
  key,
  variable,
  range,
}: {
  key: string;
  variable: string;
  range: FadeRange;
}) {
  const clamp = (fade: number): number =>
    Math.round(Math.min(range.max, Math.max(range.min, fade)));

  const stored = (value: string | null): number => {
    const parsed = Number(value);
    // `Number(null)` and `Number('')` are both 0, which no fade is.
    return Number.isFinite(parsed) && parsed > 0 ? clamp(parsed) : range.default;
  };

  const useFade = create<FadeState>()(
    persist(
      (set) => ({
        fade: range.default,
        setFade: (fade) => set({ fade: clamp(fade) }),
      }),
      {
        name: key,
        storage: rawPreferenceStorage<Pick<FadeState, 'fade'>>(
          (value) => ({ fade: stored(value) }),
          (state) => String(state.fade),
        ),
        partialize: (state) => ({ fade: state.fade }),
      },
    ),
  );

  const paint = (fade: number): void => {
    document.documentElement.style.setProperty(variable, String(fade / 100));
  };

  /** Apply the CSS variable and follow later changes. Returns the unsubscribe. */
  const follow = (): (() => void) => {
    paint(useFade.getState().fade);
    return useFade.subscribe((state) => paint(state.fade));
  };

  const preview = (fade: number): void => paint(clamp(fade));

  return { useFade, follow, preview };
}
