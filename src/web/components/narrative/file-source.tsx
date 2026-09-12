import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useFetcher } from 'react-router';
import { filePair, type FilePair, type ReviewBundle } from '@/domain/review/bundle';
import type { FileResponse } from '@/web/lib/github-api';

/**
 * Where the reader's inline diffs get both sides of a file. The hosted app
 * reads them from GitHub through `/api/github/file`; a local report reads them
 * from the bundle embedded in the page. The diff itself does not know which:
 * it calls `useFilePair` and gets `undefined` while the pair loads, then a
 * stable object it can memoise on.
 *
 * `useFilePair` always mounts a fetcher, so the reader needs a data router
 * above it in both places; under an embedded source the fetcher stays idle.
 */
type FileSource =
  | { kind: 'github'; owner: string; repo: string; baseRef: string; headRef: string }
  | { kind: 'embedded'; pairs: ReadonlyMap<string, FilePair>; missing: FilePair };

const FileSourceContext = createContext<FileSource | null>(null);

export function useFilePair(path: string): FilePair | undefined {
  const source = useContext(FileSourceContext);
  const fetcher = useFetcher<FileResponse>();
  const load = fetcher.load;
  const href =
    source?.kind === 'github'
      ? `/api/github/file?${new URLSearchParams({
          owner: source.owner,
          repo: source.repo,
          path,
          base: source.baseRef,
          head: source.headRef,
        }).toString()}`
      : null;
  useEffect(() => {
    if (href) void load(href);
  }, [load, href]);

  if (!source) {
    throw new Error('useFilePair needs a <GithubFileSource> or <EmbeddedFileSource> above it');
  }
  if (source.kind === 'embedded') return source.pairs.get(path) ?? source.missing;
  return fetcher.data;
}

/**
 * Both blobs of a file from GitHub, in one round trip per file. A rejected
 * token never reaches the diff: the resource route redirects to `/relink` and
 * the fetcher follows.
 */
export function GithubFileSource({
  owner,
  repo,
  baseRef,
  headRef,
  children,
}: {
  owner: string;
  repo: string;
  /** The target's base SHA. */
  baseRef: string;
  /** The reviewed head SHA. */
  headRef: string;
  children: ReactNode;
}) {
  const source = useMemo<FileSource>(
    () => ({ kind: 'github', owner, repo, baseRef, headRef }),
    [owner, repo, baseRef, headRef],
  );
  return <FileSourceContext value={source}>{children}</FileSourceContext>;
}

/** Both sides of every file from the bundle a local report carries; never loading. */
export function EmbeddedFileSource({
  bundle,
  children,
}: {
  bundle: ReviewBundle;
  children: ReactNode;
}) {
  const source = useMemo<FileSource>(
    () => ({
      kind: 'embedded',
      pairs: new Map(Object.keys(bundle.files).map((path) => [path, filePair(bundle, path)])),
      missing: filePair(bundle, ''),
    }),
    [bundle],
  );
  return <FileSourceContext value={source}>{children}</FileSourceContext>;
}
