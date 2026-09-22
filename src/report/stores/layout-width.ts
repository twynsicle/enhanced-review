import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';
import { LAYOUT_WIDTHS } from '@/report/theme/tokens';

/**
 * The reader's width: the whole window ⇄ 110rem. Persisted raw under the
 * `er-layout` key, and painted as `--review-max-width` on `<html>` so the
 * header and the page beneath it take the same width.
 */
export type LayoutWidth = keyof typeof LAYOUT_WIDTHS;

export const LAYOUT_WIDTH_KEY = 'er-layout';

interface LayoutWidthState {
  width: LayoutWidth;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<LayoutWidthState, 'width'>>(
  (stored) => ({ width: stored === 'wide' ? 'wide' : 'full' }),
  (state) => state.width,
);

export const useLayoutWidth = create<LayoutWidthState>()(
  persist(
    (set) => ({
      width: 'full',
      toggle: () => set((state) => ({ width: state.width === 'wide' ? 'full' : 'wide' })),
    }),
    {
      name: LAYOUT_WIDTH_KEY,
      storage: rawStorage,
      partialize: (state) => ({ width: state.width }),
    },
  ),
);

export function applyLayoutWidth(width: LayoutWidth): void {
  document.documentElement.style.setProperty('--review-max-width', LAYOUT_WIDTHS[width]);
}

/** Apply the CSS variable and follow later changes. Returns the unsubscribe. */
export function followLayoutWidth(): () => void {
  applyLayoutWidth(useLayoutWidth.getState().width);
  return useLayoutWidth.subscribe((state) => applyLayoutWidth(state.width));
}
