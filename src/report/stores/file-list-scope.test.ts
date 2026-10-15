import { beforeEach, describe, expect, it } from 'vitest';
import { FILE_LIST_SCOPE_KEY, useFileListScope } from './file-list-scope';

function scopeAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(FILE_LIST_SCOPE_KEY);
  else window.localStorage.setItem(FILE_LIST_SCOPE_KEY, stored);
  void useFileListScope.persist.rehydrate();
  return useFileListScope.getState().scope;
}

describe('file list scope', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFileListScope.setState({ scope: 'all' });
  });

  it('lists every file when nothing is stored', () => {
    expect(scopeAfterRehydrate(null)).toBe('all');
  });

  it("keeps a reader who chose the chapter's files on them", () => {
    expect(scopeAfterRehydrate('chapter')).toBe('chapter');
  });

  it('ignores a value it does not recognise', () => {
    expect(scopeAfterRehydrate('section')).toBe('all');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFileListScope.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_SCOPE_KEY)).toBe('chapter');
    useFileListScope.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_SCOPE_KEY)).toBe('all');
  });
});
