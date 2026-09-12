import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/web/stores/raw-preference';
import { SIDEBAR_WIDTHS } from '@/web/theme/tokens';

/**
 * How wide the reader's navigation column is, in pixels. Persisted raw under
 * `er-sidebar` so the pre-paint script in `root.tsx` can apply it without a
 * parser, and applied as `--review-sidebar-width` on `<html>` rather than as an
 * inline style on the grid: an inline style is React's default value painting
 * over whatever that script had already put there, which is the jump the script
 * exists to prevent.
 *
 * Alone among these preferences the value is a number, so a stored value is
 * clamped rather than matched. Anything outside the handle's own stops — hand
 * edited, or left over from a narrower set — lands somewhere usable instead of
 * collapsing the column or swallowing the article.
 */
export const SIDEBAR_WIDTH_KEY = 'er-sidebar';

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(SIDEBAR_WIDTHS.max, Math.max(SIDEBAR_WIDTHS.min, width)));
}

interface SidebarWidthState {
  width: number;
  setWidth: (width: number) => void;
}

function storedWidth(stored: string | null): number {
  const parsed = Number(stored);
  // `Number(null)` and `Number('')` are both 0, so one test covers the empty
  // cases as well as the unparseable ones.
  return Number.isFinite(parsed) && parsed > 0 ? clampSidebarWidth(parsed) : SIDEBAR_WIDTHS.default;
}

const rawStorage = rawPreferenceStorage<Pick<SidebarWidthState, 'width'>>(
  (stored) => ({ width: storedWidth(stored) }),
  (state) => String(state.width),
);

export const useSidebarWidth = create<SidebarWidthState>()(
  persist(
    (set) => ({
      width: SIDEBAR_WIDTHS.default,
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
    }),
    {
      name: SIDEBAR_WIDTH_KEY,
      storage: rawStorage,
      partialize: (state) => ({ width: state.width }),
      skipHydration: true,
    },
  ),
);

/**
 * Paint a width without going through the store. A drag reaches here on every
 * pointer move: `persist` writes its slice after every `set` unconditionally,
 * and the reader re-renders every editor under it, neither of which a value
 * that is still moving has earned. The drag commits once, on release.
 */
export function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty('--review-sidebar-width', `${width}px`);
}

/** Rehydrate from storage, apply the CSS variable, and follow later changes. Returns the unsubscribe. */
export function bindSidebarWidth(): () => void {
  void useSidebarWidth.persist.rehydrate();
  applySidebarWidth(useSidebarWidth.getState().width);
  return useSidebarWidth.subscribe((state) => applySidebarWidth(state.width));
}
