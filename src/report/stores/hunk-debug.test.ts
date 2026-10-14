import { beforeEach, describe, expect, it } from 'vitest';
import { HUNK_DEBUG_KEY, useHunkDebug } from './hunk-debug';

function debugAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(HUNK_DEBUG_KEY);
  else window.localStorage.setItem(HUNK_DEBUG_KEY, stored);
  void useHunkDebug.persist.rehydrate();
  return useHunkDebug.getState().debug;
}

describe('hunk debug', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useHunkDebug.setState({ debug: 'off' });
  });

  it('is off when nothing is stored', () => {
    expect(debugAfterRehydrate(null)).toBe('off');
  });

  it('keeps a reader who turned it on', () => {
    expect(debugAfterRehydrate('on')).toBe('on');
  });

  it('ignores a value it does not recognise', () => {
    expect(debugAfterRehydrate('verbose')).toBe('off');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useHunkDebug.getState().toggle();
    expect(window.localStorage.getItem(HUNK_DEBUG_KEY)).toBe('on');
    useHunkDebug.getState().toggle();
    expect(window.localStorage.getItem(HUNK_DEBUG_KEY)).toBe('off');
  });
});
