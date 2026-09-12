import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/web/stores/raw-preference';
import { LAYOUT_WIDTHS } from '@/web/theme/tokens';

/**
 * The reader's width: the whole window ⇄ 110rem. Persisted under the
 * `er-layout` key as the raw value, not JSON, so the pre-paint script in
 * `root.tsx` can read it without a parser. The store skips automatic
 * hydration: the server and the hydrating render both see the `full` default,
 * and `bindLayoutWidth()` (called once from the toggle) rehydrates after mount
 * and keeps `--review-max-width` on `<html>` in sync.
 *
 * The two stops used to be `narrow | wide`, and the migration rides on the raw
 * value: a stored `wide` still names 110rem, and a stored `narrow` no longer
 * matches anything and falls through to `full`, which is where a reader who
 * had chosen the old default wants to be.
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
      skipHydration: true,
    },
  ),
);

export function applyLayoutWidth(width: LayoutWidth): void {
  document.documentElement.style.setProperty('--review-max-width', LAYOUT_WIDTHS[width]);
}

/** Rehydrate from storage, apply the CSS variable, and follow later changes. Returns the unsubscribe. */
export function bindLayoutWidth(): () => void {
  void useLayoutWidth.persist.rehydrate();
  applyLayoutWidth(useLayoutWidth.getState().width);
  return useLayoutWidth.subscribe((state) => applyLayoutWidth(state.width));
}
