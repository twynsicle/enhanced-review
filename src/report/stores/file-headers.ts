import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { rawPreferenceStorage } from '@/report/stores/raw-preference';

/**
 * Whether a code card's header shows every fact about its file, wrapped onto
 * as many lines as they take, or keeps to one line and clips what does not
 * fit. The header sticks under the topbar while its diff scrolls, so every
 * line it takes is a line of code the reader does not see; a file moved in
 * many parts can carry enough tags to take several.
 *
 * One setting for every card rather than one per card: the cost is the same
 * on every file, and a reader who wants the room back wants it everywhere.
 *
 * Persisted raw under `er-file-headers`, as the other reader preferences are.
 */
export type FileHeaders = 'full' | 'one-line';

export const FILE_HEADERS_KEY = 'er-file-headers';

interface FileHeadersState {
  headers: FileHeaders;
  toggle: () => void;
}

const rawStorage = rawPreferenceStorage<Pick<FileHeadersState, 'headers'>>(
  (stored) => ({ headers: stored === 'one-line' ? 'one-line' : 'full' }),
  (state) => state.headers,
);

export const useFileHeaders = create<FileHeadersState>()(
  persist(
    (set) => ({
      headers: 'full',
      toggle: () =>
        set((state) => ({ headers: state.headers === 'one-line' ? 'full' : 'one-line' })),
    }),
    {
      name: FILE_HEADERS_KEY,
      storage: rawStorage,
      partialize: (state) => ({ headers: state.headers }),
    },
  ),
);
