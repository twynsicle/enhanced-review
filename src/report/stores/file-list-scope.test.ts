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
    useFileListScope.setState(useFileListScope.getInitialState());
  });

  it("lists the chapter's files when nothing is stored", () => {
    expect(scopeAfterRehydrate(null)).toBe('chapter');
  });

  it('keeps a reader who chose every file on them', () => {
    expect(scopeAfterRehydrate('all')).toBe('all');
  });

  it('ignores a value it does not recognise', () => {
    expect(scopeAfterRehydrate('section')).toBe('chapter');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFileListScope.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_SCOPE_KEY)).toBe('all');
    useFileListScope.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_SCOPE_KEY)).toBe('chapter');
  });
});
