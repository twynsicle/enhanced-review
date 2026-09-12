import { beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_WIDTHS } from '@/web/theme/tokens';
import { bindLayoutWidth, LAYOUT_WIDTH_KEY, useLayoutWidth } from './layout-width';

function widthAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(LAYOUT_WIDTH_KEY);
  else window.localStorage.setItem(LAYOUT_WIDTH_KEY, stored);
  bindLayoutWidth()();
  return useLayoutWidth.getState().width;
}

describe('layout width', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useLayoutWidth.setState({ width: 'full' });
  });

  it('fills the window when nothing is stored', () => {
    expect(widthAfterRehydrate(null)).toBe('full');
    expect(document.documentElement.style.getPropertyValue('--review-max-width')).toBe(
      LAYOUT_WIDTHS.full,
    );
  });

  it('keeps a reader who chose the narrower stop on it', () => {
    expect(widthAfterRehydrate('wide')).toBe('wide');
    expect(document.documentElement.style.getPropertyValue('--review-max-width')).toBe(
      LAYOUT_WIDTHS.wide,
    );
  });

  /*
   * The stops used to be `narrow | wide`. `narrow` was the old default, so the
   * readers holding it are the ones this change is for: they should land on the
   * full window rather than be pinned to a value that no longer exists.
   */
  it('moves a retired `narrow` preference onto the new default', () => {
    expect(widthAfterRehydrate('narrow')).toBe('full');
  });

  it('ignores a value it does not recognise', () => {
    expect(widthAfterRehydrate('enormous')).toBe('full');
  });

  it('stores the raw word, so the pre-paint script can read it without a parser', () => {
    useLayoutWidth.setState({ width: 'full' });
    useLayoutWidth.getState().toggle();
    expect(window.localStorage.getItem(LAYOUT_WIDTH_KEY)).toBe('wide');
  });
});
