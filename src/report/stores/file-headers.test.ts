import { beforeEach, describe, expect, it } from 'vitest';
import { FILE_HEADERS_KEY, useFileHeaders } from './file-headers';

function headersAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(FILE_HEADERS_KEY);
  else window.localStorage.setItem(FILE_HEADERS_KEY, stored);
  void useFileHeaders.persist.rehydrate();
  return useFileHeaders.getState().headers;
}

describe('file headers', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFileHeaders.setState(useFileHeaders.getInitialState());
  });

  it('keeps to one line when nothing is stored', () => {
    expect(headersAfterRehydrate(null)).toBe('one-line');
  });

  it('keeps a reader who chose every fact', () => {
    expect(headersAfterRehydrate('full')).toBe('full');
  });

  it('ignores a value it does not recognise', () => {
    expect(headersAfterRehydrate('folded')).toBe('one-line');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFileHeaders.getState().toggle();
    expect(window.localStorage.getItem(FILE_HEADERS_KEY)).toBe('full');
    useFileHeaders.getState().toggle();
    expect(window.localStorage.getItem(FILE_HEADERS_KEY)).toBe('one-line');
  });
});
