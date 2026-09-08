import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import { LAYOUT_WIDTHS } from '@/web/theme/tokens';

/**
 * Narrow ⇄ wide page width. Persisted under the same
 * `er-layout` key and raw `narrow | wide` value the old app used, so the
 * pre-paint script in `root.tsx` can read it without parsing JSON. The store
 * skips automatic hydration: the server and the hydrating render both see
 * `narrow`, and `bindLayoutWidth()` (called once from the toggle) rehydrates
 * after mount and keeps `--review-max-width` on `<html>` in sync.
 */
export type LayoutWidth = keyof typeof LAYOUT_WIDTHS;

export const LAYOUT_WIDTH_KEY = 'er-layout';

interface LayoutWidthState {
  width: LayoutWidth;
  toggle: () => void;
}

const rawStorage: PersistStorage<Pick<LayoutWidthState, 'width'>> = {
  getItem: (name) => {
    try {
      const stored = window.localStorage.getItem(name);
      return { state: { width: stored === 'wide' ? 'wide' : 'narrow' } };
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value.state.width);
    } catch {
      /* private mode / quota: the preference just does not stick */
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const useLayoutWidth = create<LayoutWidthState>()(
  persist(
    (set) => ({
      width: 'narrow',
      toggle: () => set((state) => ({ width: state.width === 'wide' ? 'narrow' : 'wide' })),
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
