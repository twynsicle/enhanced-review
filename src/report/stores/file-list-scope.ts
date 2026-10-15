import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Which changed files the sidebar lists: `all` of them, or only the ones the
 * open chapter cites. `all` is the default, since the list's first job is to
 * say what the change touched; the chapter's own files are a narrower view a
 * reader asks for. With no chapter open there is nothing to narrow to, and
 * the sidebar lists everything whatever this says.
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
  (stored) => ({ scope: stored === 'chapter' ? 'chapter' : 'all' }),
  (state) => state.scope,
);

export const useFileListScope = create<FileListScopeState>()(
  persist(
    (set) => ({
      scope: 'all',
      toggle: () => set((state) => ({ scope: state.scope === 'chapter' ? 'all' : 'chapter' })),
    }),
    {
      name: FILE_LIST_SCOPE_KEY,
      storage: rawStorage,
      partialize: (state) => ({ scope: state.scope }),
    },
  ),
);
