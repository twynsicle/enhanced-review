import { beforeEach, describe, expect, it } from 'vitest';
import { SIDEBAR_WIDTHS } from '@/web/theme/tokens';
import { bindSidebarWidth, SIDEBAR_WIDTH_KEY, useSidebarWidth } from './sidebar-width';

function widthAfterRehydrate(stored: string | null): number {
  if (stored === null) window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
  else window.localStorage.setItem(SIDEBAR_WIDTH_KEY, stored);
  bindSidebarWidth()();
  return useSidebarWidth.getState().width;
}

function paintedWidth(): string {
  return document.documentElement.style.getPropertyValue('--review-sidebar-width');
}

describe('sidebar width', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSidebarWidth.setState({ width: SIDEBAR_WIDTHS.default });
  });

  it('opens at the default when nothing is stored', () => {
    expect(widthAfterRehydrate(null)).toBe(SIDEBAR_WIDTHS.default);
    expect(paintedWidth()).toBe(`${SIDEBAR_WIDTHS.default}px`);
  });

  it('gives a reader back the column they dragged to', () => {
    expect(widthAfterRehydrate('320')).toBe(320);
    expect(paintedWidth()).toBe('320px');
  });

  /*
   * The other preferences are words, and an unrecognised one falls through to
   * the default. A number has a usable answer either side of the stops, so a
   * value from outside them — hand edited, or left over from a wider set — is
   * pulled back to the nearest rather than thrown away.
   */
  it('pulls a value from outside the stops back to the nearest one', () => {
    expect(widthAfterRehydrate('9999')).toBe(SIDEBAR_WIDTHS.max);
    expect(widthAfterRehydrate('10')).toBe(SIDEBAR_WIDTHS.min);
  });

  it('falls back to the default on anything that is not a width', () => {
    expect(widthAfterRehydrate('wide')).toBe(SIDEBAR_WIDTHS.default);
    expect(widthAfterRehydrate('')).toBe(SIDEBAR_WIDTHS.default);
    expect(widthAfterRehydrate('-40')).toBe(SIDEBAR_WIDTHS.default);
  });

  it('stores the raw number, so the pre-paint script can range-check it without a parser', () => {
    useSidebarWidth.getState().setWidth(300);
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe('300');
  });

  it('clamps on the way in, so a drag past the stops cannot be stored', () => {
    useSidebarWidth.getState().setWidth(9999);
    expect(useSidebarWidth.getState().width).toBe(SIDEBAR_WIDTHS.max);
  });
});
