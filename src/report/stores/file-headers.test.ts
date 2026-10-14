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
    useFileHeaders.setState({ headers: 'full' });
  });

  it('shows every fact when nothing is stored', () => {
    expect(headersAfterRehydrate(null)).toBe('full');
  });

  it('keeps a reader who chose one line', () => {
    expect(headersAfterRehydrate('one-line')).toBe('one-line');
  });

  it('ignores a value it does not recognise', () => {
    expect(headersAfterRehydrate('folded')).toBe('full');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFileHeaders.getState().toggle();
    expect(window.localStorage.getItem(FILE_HEADERS_KEY)).toBe('one-line');
    useFileHeaders.getState().toggle();
    expect(window.localStorage.getItem(FILE_HEADERS_KEY)).toBe('full');
  });
});
