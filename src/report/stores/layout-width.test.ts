import { beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_WIDTHS } from '@/report/theme/tokens';
import { followLayoutWidth, LAYOUT_WIDTH_KEY, useLayoutWidth } from './layout-width';

function widthAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(LAYOUT_WIDTH_KEY);
  else window.localStorage.setItem(LAYOUT_WIDTH_KEY, stored);
  void useLayoutWidth.persist.rehydrate();
  followLayoutWidth()();
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

  it('ignores a value it does not recognise', () => {
    expect(widthAfterRehydrate('enormous')).toBe('full');
  });

  it('stores the raw word', () => {
    useLayoutWidth.setState({ width: 'full' });
    useLayoutWidth.getState().toggle();
    expect(window.localStorage.getItem(LAYOUT_WIDTH_KEY)).toBe('wide');
  });
});
