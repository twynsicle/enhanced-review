'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import type { DiffChunk } from '@enhanced-review/review-types';
import {
  buildInlineDiffSnippets,
  type InlineDiffSnippet,
} from '@/lib/narrative/inline-diff-snippets';
import { detectLanguage } from '@/lib/narrative/language-map';
import type { FileAtRef, ViewTimeError, ViewTimeResult } from '@/lib/github/view-time';

/**
 * Web port of the diffy POC's `InlineDiffChunk`. Fetches both base and
 * head blobs through `/api/github/file` (server-side proxies the
 * viewer's OAuth token), slices them down with `buildInlineDiffSnippets`,
 * and renders one Monaco `DiffEditor` per snippet group.
 *
 * The Monaco editor is lazy-loaded via `next/dynamic({ ssr: false })` so
 * it neither inflates the initial bundle nor SSR-renders (it touches
 * `window` on mount).
 */

const DiffEditor = dynamic(() => import('@monaco-editor/react').then((mod) => mod.DiffEditor), {
  ssr: false,
  loading: () => <div className="h-15 animate-pulse rounded bg-muted/50" />,
});

const CONTEXT_LINES = 5;
const MIN_EDITOR_HEIGHT = 60;
const EDITOR_HEIGHT_PADDING = 12;

interface InlineDiffChunkProps {
  chunk: DiffChunk;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}

type FetchState =
  | { kind: 'loading' }
  | {
      kind: 'ok';
      data: {
        original: string;
        modified: string;
        originalLineCount: number;
        modifiedLineCount: number;
        language: string;
      };
    }
  | { kind: 'error'; error: ViewTimeError };

type FileResponseBody = ViewTimeResult<FileAtRef>;

async function fetchFileAtRef(args: {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}): Promise<FileResponseBody> {
  const url = new URL('/api/github/file', window.location.origin);
  url.searchParams.set('owner', args.owner);
  url.searchParams.set('repo', args.repo);
  url.searchParams.set('path', args.path);
  url.searchParams.set('ref', args.ref);

  const res = await fetch(url.toString());
  if (res.status === 401) {
    window.location.assign('/relink');
    return { ok: false, error: { kind: 'unauthorized', status: 401 } };
  }
  if (!res.ok) {
    return { ok: false, error: { kind: 'unknown', status: res.status } };
  }
  return (await res.json()) as FileResponseBody;
}

function makeOffsetLineNumbers(offset: number): editor.LineNumbersType {
  return (lineNumber: number): string => String(lineNumber + offset - 1);
}

interface InlineDiffSnippetEditorProps {
  chunkFilename: string;
  language: string;
  snippet: InlineDiffSnippet;
  expanded: boolean;
}

function buildModelPath(
  filename: string,
  snippetKey: string,
  side: 'original' | 'modified',
): string {
  const encodedPath = filename
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `file:///__inline__/${side}/${encodeURIComponent(snippetKey)}/${encodedPath}`;
}

function InlineDiffSnippetEditor({
  chunkFilename,
  language,
  snippet,
  expanded,
}: InlineDiffSnippetEditorProps) {
  const [diffEditor, setDiffEditor] = useState<editor.IStandaloneDiffEditor | null>(null);
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);

  useEffect(() => {
    if (!diffEditor) return;

    const originalEditor = diffEditor.getOriginalEditor();
    const modifiedEditor = diffEditor.getModifiedEditor();

    originalEditor.updateOptions({
      lineNumbers: expanded ? 'on' : makeOffsetLineNumbers(snippet.originalStartLine),
      lineNumbersMinChars: 3,
    });
    modifiedEditor.updateOptions({
      lineNumbers: expanded ? 'on' : makeOffsetLineNumbers(snippet.modifiedStartLine),
      lineNumbersMinChars: 3,
    });
    diffEditor.layout();

    const updateHeight = (): void => {
      const contentHeight = Math.max(
        originalEditor.getContentHeight(),
        modifiedEditor.getContentHeight(),
        MIN_EDITOR_HEIGHT - EDITOR_HEIGHT_PADDING,
      );
      setEditorHeight(contentHeight + EDITOR_HEIGHT_PADDING);
    };

    const originalDisposable = originalEditor.onDidContentSizeChange(updateHeight);
    const modifiedDisposable = modifiedEditor.onDidContentSizeChange(updateHeight);
    const diffDisposable = diffEditor.onDidUpdateDiff(updateHeight);

    updateHeight();

    return () => {
      originalDisposable.dispose();
      modifiedDisposable.dispose();
      diffDisposable.dispose();
    };
  }, [diffEditor, expanded, snippet.modifiedStartLine, snippet.originalStartLine]);

  // Click anywhere on the "X hidden lines" centre text to unfold.
  useEffect(() => {
    if (!diffEditor || expanded) return;

    const container = diffEditor.getContainerDomNode();
    const handleClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const center = target.closest('.diff-hidden-lines .center');
      if (!center) return;
      if (target.closest('a[role="button"], .breadcrumb-item')) return;

      const unfoldButton = center.querySelector<HTMLElement>('a[role="button"]');
      unfoldButton?.click();
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [diffEditor, expanded]);

  return (
    <div className="overflow-hidden bg-[#1e1e1e]" style={{ height: editorHeight }}>
      <DiffEditor
        original={snippet.original}
        modified={snippet.modified}
        language={language}
        originalLanguage={language}
        modifiedLanguage={language}
        originalModelPath={buildModelPath(chunkFilename, snippet.key, 'original')}
        modifiedModelPath={buildModelPath(chunkFilename, snippet.key, 'modified')}
        theme="vs-dark"
        onMount={setDiffEditor}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          renderOverviewRuler: false,
          overviewRulerLanes: 0,
          overviewRulerBorder: false,
          lineNumbers: 'on',
          lineNumbersMinChars: 3,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: 'hidden',
            horizontal: 'auto',
            handleMouseWheel: false,
          },
          hideUnchangedRegions: expanded
            ? { enabled: false }
            : {
                enabled: true,
                contextLineCount: CONTEXT_LINES,
                minimumLineCount: 1,
                revealLineCount: CONTEXT_LINES,
              },
          folding: false,
          glyphMargin: false,
          lineDecorationsWidth: 8,
        }}
      />
    </div>
  );
}

export function InlineDiffChunk({ chunk, owner, repo, baseRef, headRef }: InlineDiffChunkProps) {
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const cancelRef = useRef(false);

  const chunkHunks = useMemo(() => (Array.isArray(chunk.hunks) ? chunk.hunks : []), [chunk]);

  useEffect(() => {
    // No synchronous reset to `loading` here — props are stable for the
    // life of a chunk, so the only state transitions are the initial
    // fetch resolving. If a parent ever re-uses the component for a
    // different chunk, the stale data will briefly show until the new
    // fetch resolves, which is acceptable.
    cancelRef.current = false;

    void Promise.all([
      fetchFileAtRef({ owner, repo, path: chunk.filename, ref: baseRef }),
      fetchFileAtRef({ owner, repo, path: chunk.filename, ref: headRef }),
    ]).then(([base, head]) => {
      if (cancelRef.current) return;

      // 'unauthorized' triggers a /relink redirect inside fetchFileAtRef;
      // bail without transitioning state to avoid a flicker.
      if (
        (!base.ok && base.error.kind === 'unauthorized') ||
        (!head.ok && head.error.kind === 'unauthorized')
      ) {
        return;
      }

      // Both 404 → file existed on neither side, which is impossible for
      // a chunk surfaced by the AI unless the viewer lost access to the
      // repo or the SHAs are gone. Treat as an error so the user sees a
      // meaningful fallback rather than two empty editors.
      if (
        !base.ok &&
        !head.ok &&
        base.error.kind === 'not-found' &&
        head.error.kind === 'not-found'
      ) {
        setState({ kind: 'error', error: base.error });
        return;
      }

      // Single-side 404 → the file legitimately doesn't exist on that
      // side (added file at base, deleted file at head). Treat as empty.
      const baseEmpty = !base.ok && base.error.kind === 'not-found';
      const headEmpty = !head.ok && head.error.kind === 'not-found';

      if (!base.ok && !baseEmpty) {
        setState({ kind: 'error', error: base.error });
        return;
      }
      if (!head.ok && !headEmpty) {
        setState({ kind: 'error', error: head.error });
        return;
      }

      const original = base.ok ? base.data.content : '';
      const modified = head.ok ? head.data.content : '';
      const originalLineCount = base.ok ? base.data.lineCount : 0;
      const modifiedLineCount = head.ok ? head.data.lineCount : 0;
      const language = base.ok
        ? base.data.language
        : head.ok
          ? head.data.language
          : detectLanguage(chunk.filename);

      setState({
        kind: 'ok',
        data: { original, modified, originalLineCount, modifiedLineCount, language },
      });
    });

    return () => {
      cancelRef.current = true;
    };
  }, [owner, repo, chunk.filename, baseRef, headRef]);

  const snippets = useMemo<InlineDiffSnippet[]>(() => {
    if (state.kind !== 'ok') return [];
    const data = state.data;

    if (expanded) {
      return [
        {
          key: 'full-file',
          original: data.original,
          modified: data.modified,
          originalStartLine: 1,
          modifiedStartLine: 1,
        },
      ];
    }

    const collapsed = buildInlineDiffSnippets({
      hunks: chunkHunks,
      original: data.original,
      modified: data.modified,
      originalLineCount: data.originalLineCount,
      modifiedLineCount: data.modifiedLineCount,
      contextLines: CONTEXT_LINES,
    });

    if (collapsed.length > 0) return collapsed;

    return [
      {
        key: 'fallback-full-file',
        original: data.original,
        modified: data.modified,
        originalStartLine: 1,
        modifiedStartLine: 1,
      },
    ];
  }, [state, expanded, chunkHunks]);

  const handleToggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const language = state.kind === 'ok' ? state.data.language : chunk.language;
  const { dirname, basename } = splitFilename(chunk.filename);

  return (
    <div
      className="overflow-hidden rounded-lg ring-1 ring-foreground/10 bg-card"
      role="figure"
      aria-label={`Diff for ${chunk.filename}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-foreground/10 bg-muted/30 px-3 py-2 text-xs">
        <span className="min-w-0 font-mono break-all">
          {dirname.length > 0 && <span className="text-[11px] text-subtle">{dirname}/</span>}
          <span className="text-[13px] font-semibold text-foreground">{basename}</span>
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{language}</span>
        {state.kind === 'ok' && (
          <button
            type="button"
            className="ml-auto rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={handleToggleExpand}
          >
            {expanded ? 'Show changes only' : 'Show full file'}
          </button>
        )}
      </div>

      {state.kind === 'loading' && (
        <div className="px-3 py-4 text-xs text-muted-foreground">Loading…</div>
      )}

      {state.kind === 'error' && <DiffErrorBody error={state.error} />}

      {state.kind === 'ok' &&
        snippets.map((snippet) => (
          <InlineDiffSnippetEditor
            key={snippet.key}
            chunkFilename={chunk.filename}
            language={language}
            snippet={snippet}
            expanded={expanded}
          />
        ))}
    </div>
  );
}

function DiffErrorBody({ error }: { error: ViewTimeError }) {
  const message = describeError(error);
  return (
    <div className="px-3 py-4 text-xs text-muted-foreground">
      <p>{message}</p>
    </div>
  );
}

function splitFilename(path: string): { dirname: string; basename: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dirname: '', basename: path };
  return { dirname: path.slice(0, slash), basename: path.slice(slash + 1) };
}

function describeError(error: ViewTimeError): string {
  switch (error.kind) {
    case 'no-access':
      return "You don't have access to this repo on GitHub — the inline diff can't be loaded, but the review chapters are still readable.";
    case 'not-found':
      return 'GitHub returned 404 for this file at both refs. The repo or commit may have been deleted.';
    case 'too-large':
      return 'This file is too large to preview inline.';
    case 'rate-limited':
      return 'GitHub API rate limit reached. Try again in a minute.';
    case 'unauthorized':
      // Caller should have redirected to /relink before reaching this branch.
      return 'GitHub authentication expired. Re-link to view this diff.';
    default:
      return "Couldn't load the diff for this file.";
  }
}
