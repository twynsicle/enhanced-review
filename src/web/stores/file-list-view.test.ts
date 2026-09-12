import { beforeEach, describe, expect, it } from 'vitest';
import { bindFileListView, FILE_LIST_VIEW_KEY, useFileListView } from './file-list-view';

function viewAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(FILE_LIST_VIEW_KEY);
  else window.localStorage.setItem(FILE_LIST_VIEW_KEY, stored);
  bindFileListView();
  return useFileListView.getState().view;
}

describe('file list view', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useFileListView.setState({ view: 'flat' });
  });

  it('lists files flat when nothing is stored', () => {
    expect(viewAfterRehydrate(null)).toBe('flat');
  });

  it('keeps a reader who chose the tree on it', () => {
    expect(viewAfterRehydrate('tree')).toBe('tree');
  });

  it('ignores a value it does not recognise', () => {
    expect(viewAfterRehydrate('outline')).toBe('flat');
  });

  it('stores the raw word, the way the other reader preferences do', () => {
    useFileListView.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_VIEW_KEY)).toBe('tree');
    useFileListView.getState().toggle();
    expect(window.localStorage.getItem(FILE_LIST_VIEW_KEY)).toBe('flat');
  });
});
