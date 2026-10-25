import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * How the sidebar draws the changed files: `flat` gives every file one row,
 * basename first with its directory trailing behind it; `tree` groups them
 * under directory rows that fold.
 *
 * `tree` is the default. The list is narrowed to the open chapter's files
 * unless the reader widens it, so the tree's directory rows are few, and they
 * say where in the codebase a chapter lands, which a column of basenames does
 * not. Single-child chains collapse into one row, so a deep path costs one.
 * A flat list of forty siblings reads better than its tree, so this stays a
 * choice.
 *
 * Persisted raw under `er-file-list`, as `er-diff-view` and `er-diff-wrap`
 * are. Expansion state is deliberately not part of this: which directories a
 * reader folded is about the review in front of them, not about how they like
 * to read, and restoring it across visits would hide files a reader has never
 * seen.
 */
export type FileListView = 'flat' | 'tree';

export const FILE_LIST_VIEW_KEY = 'er-file-list';

interface FileListViewState {
  view: FileListView;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<FileListViewState, 'view'>>(
  (stored) => ({ view: stored === 'flat' ? 'flat' : 'tree' }),
  (state) => state.view,
);

export const useFileListView = create<FileListViewState>()(
  persist(
    (set) => ({
      view: 'tree',
      toggle: () => set((state) => ({ view: state.view === 'tree' ? 'flat' : 'tree' })),
    }),
    {
      name: FILE_LIST_VIEW_KEY,
      storage: rawStorage,
      partialize: (state) => ({ view: state.view }),
    },
  ),
);
