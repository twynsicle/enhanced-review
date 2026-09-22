import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * How the sidebar draws the changed files: `flat` gives every file one row,
 * basename first with its directory trailing behind it; `tree` groups them
 * under directory rows that fold.
 *
 * `flat` is the default because it is the shorter list at the sizes most
 * reviews are — a dozen files scattered around the tree read as a dozen rows,
 * where the tree spends half its rows on structure nobody asked about. The
 * tree earns its keep in the other direction, on the review that touches
 * fifteen files across four directories and repeats the same prefix down the
 * whole column. Which of those is in front of the reader is not something the
 * file count can decide — a flat list of forty siblings is fine and a tree of
 * six across five directories is not — so this is a choice, and the unchosen
 * state is the one readers already have.
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
  (stored) => ({ view: stored === 'tree' ? 'tree' : 'flat' }),
  (state) => state.view,
);

export const useFileListView = create<FileListViewState>()(
  persist(
    (set) => ({
      view: 'flat',
      toggle: () => set((state) => ({ view: state.view === 'tree' ? 'flat' : 'tree' })),
    }),
    {
      name: FILE_LIST_VIEW_KEY,
      storage: rawStorage,
      partialize: (state) => ({ view: state.view }),
    },
  ),
);
