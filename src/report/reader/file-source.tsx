import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { filePair, type FilePair, type ReviewBundle } from '@/review/bundle';

/**
 * Where the reader's inline diffs get both sides of a file: the bundle
 * embedded in the page. Each pair is built once per bundle, so a diff gets a
 * stable object it can memoise on.
 */
const FilePairsContext = createContext<ReadonlyMap<string, FilePair> | null>(null);

const MISSING: FilePair = { base: { kind: 'absent' }, head: { kind: 'absent' } };

export function useFilePair(path: string): FilePair {
  const pairs = useContext(FilePairsContext);
  if (!pairs) throw new Error('useFilePair needs an <EmbeddedFileSource> above it');
  return pairs.get(path) ?? MISSING;
}

/** Both sides of every file the bundle carries. */
export function EmbeddedFileSource({
  bundle,
  children,
}: {
  bundle: ReviewBundle;
  children: ReactNode;
}) {
  const pairs = useMemo(
    () => new Map(Object.keys(bundle.files).map((path) => [path, filePair(bundle, path)])),
    [bundle],
  );
  return <FilePairsContext value={pairs}>{children}</FilePairsContext>;
}
