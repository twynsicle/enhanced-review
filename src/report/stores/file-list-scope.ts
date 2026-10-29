import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Which changed files the sidebar lists: only the ones the open chapter
 * cites, or `all` of them. `chapter` is the default: a reader in a chapter
 * reaches for the list to find a diff in front of them, and every changed file
 * buries the few they want. With no chapter open there is nothing to narrow
 * to, and the sidebar lists everything whatever this says.
 *
 * Persisted raw under `er-file-scope`, as `er-file-list` is.
 */
export type FileListScope = 'all' | 'chapter';

export const FILE_LIST_SCOPE_KEY = 'er-file-scope';

interface FileListScopeState {
  scope: FileListScope;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<FileListScopeState, 'scope'>>(
  (stored) => ({ scope: stored === 'all' ? 'all' : 'chapter' }),
  (state) => state.scope,
);

export const useFileListScope = create<FileListScopeState>()(
  persist(
    (set) => ({
      scope: 'chapter',
      toggle: () => set((state) => ({ scope: state.scope === 'chapter' ? 'all' : 'chapter' })),
    }),
    {
      name: FILE_LIST_SCOPE_KEY,
      storage: rawStorage,
      partialize: (state) => ({ scope: state.scope }),
    },
  ),
);
