import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { filePair, type FilePair, type ReviewBundle } from '@/review/bundle';
import type { ReviewFile } from '@/review/narrative';

/**
 * Where the reader's inline diffs get both sides of a file: the bundle
 * embedded in the page. Each pair is built once per bundle, so a diff gets a
 * stable object it can memoise on. The review's record of each file rides
 * along, so a diff can say where a renamed file came from without every
 * caller threading the file list down to it.
 */
interface FileSource {
  pairs: ReadonlyMap<string, FilePair>;
  files: ReadonlyMap<string, ReviewFile>;
}

const FileSourceContext = createContext<FileSource | null>(null);

const MISSING: FilePair = { base: { kind: 'absent' }, head: { kind: 'absent' } };

function useFileSource(): FileSource {
  const source = useContext(FileSourceContext);
  if (!source) throw new Error('the file hooks need an <EmbeddedFileSource> above them');
  return source;
}

export function useFilePair(path: string): FilePair {
  return useFileSource().pairs.get(path) ?? MISSING;
}

/** The review's record of a changed file; undefined for a path it does not list. */
export function useReviewFile(path: string): ReviewFile | undefined {
  return useFileSource().files.get(path);
}

/** Both sides of every file the bundle carries. */
export function EmbeddedFileSource({
  bundle,
  children,
}: {
  bundle: ReviewBundle;
  children: ReactNode;
}) {
  const source = useMemo(
    () => ({
      pairs: new Map(Object.keys(bundle.files).map((path) => [path, filePair(bundle, path)])),
      files: new Map((bundle.review.files ?? []).map((file) => [file.filename, file])),
    }),
    [bundle],
  );
  return <FileSourceContext value={source}>{children}</FileSourceContext>;
}
