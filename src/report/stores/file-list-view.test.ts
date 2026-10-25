import { beforeEach, describe, expect, it } from 'vitest';
import { FILE_LIST_VIEW_KEY, useFileListView } from './file-list-view';

function viewAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(FILE_LIST_VIEW_KEY);
  else window.localStorage.setItem(FILE_LIST_VIEW_KEY, stored);
  void useFileListView.persist.rehydrate();
  return useFileListView.getState().view;
}

describe('file list view', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFileListView.setState(useFileListView.getInitialState());
  });

  it('groups files by directory when nothing is stored', () => {
    expect(viewAfterRehydrate(null)).toBe('tree');
  });

  it('keeps a reader who chose the flat list on it', () => {
    expect(viewAfterRehydrate('flat')).toBe('flat');
  });

  it('ignores a value it does not recognise', () => {
    expect(viewAfterRehydrate('outline')).toBe('tree');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFileListView.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_VIEW_KEY)).toBe('flat');
    useFileListView.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_VIEW_KEY)).toBe('tree');
  });
});
