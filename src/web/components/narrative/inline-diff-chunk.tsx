import { Box, Group, Skeleton, Text, UnstyledButton, useComputedColorScheme } from '@mantine/core';
import type { editor, IDisposable } from 'monaco-editor';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { FileAtRef, GithubError, GithubResult } from '@/domain/github/types';
import {
  buildInlineDiffSnippets,
  type InlineDiffSnippet,
} from '@/domain/review/inline-diff-snippets';
import { detectLanguage } from '@/domain/review/language-map';
import type { DiffChunk } from '@/domain/review/narrative';
import type { FileResponse } from '@/web/lib/github-api';
import { useHydrated } from '@/web/lib/use-hydrated';
import { token } from '@/web/theme/tokens';
import classes from './inline-diff-chunk.module.css';

/**
 * Monaco is a browser-only module (it touches `window` on import), so it is
 * loaded lazily behind the hydration guard. The library's default CDN loader
 * is kept.
 */
const DiffEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor })),
);

const CONTEXT_LINES = 5;
const MIN_EDITOR_HEIGHT = 60;
const EDITOR_HEIGHT_PADDING = 12;

interface FileData {
  original: string;
  modified: string;
  originalLineCount: number;
  modifiedLineCount: number;
  language: string;
}

type FetchState =
  { kind: 'loading' } | { kind: 'ok'; data: FileData } | { kind: 'error'; error: GithubError };

const notFound = (side: GithubResult<FileAtRef>) => !side.ok && side.error.kind === 'not-found';

/**
 * The state machine over the two sides: both `not-found` is an error
 * (the viewer lost the repo, or the SHAs are gone); one `not-found` is a
 * file added or deleted on that side, shown against empty content.
 */
function resolveFileState(body: FileResponse | undefined, filename: string): FetchState {
  if (!body) return { kind: 'loading' };
  const { base, head } = body;
  if (notFound(base) && notFound(head)) return { kind: 'error', error: { kind: 'not-found' } };
  if (!base.ok && !notFound(base)) return { kind: 'error', error: base.error };
  if (!head.ok && !notFound(head)) return { kind: 'error', error: head.error };
  return {
    kind: 'ok',
    data: {
      original: base.ok ? base.data.content : '',
      modified: head.ok ? head.data.content : '',
      originalLineCount: base.ok ? base.data.lineCount : 0,
      modifiedLineCount: head.ok ? head.data.lineCount : 0,
      language: base.ok
        ? base.data.language
        : head.ok
          ? head.data.language
          : detectLanguage(filename),
    },
  };
}

function fullFile(key: string, data: FileData): InlineDiffSnippet {
  return {
    key,
    original: data.original,
    modified: data.modified,
    originalStartLine: 1,
    modifiedStartLine: 1,
  };
}

function describeError(error: GithubError): string {
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
      return 'GitHub authentication expired. Re-link to view this diff.';
    default:
      return "Couldn't load the diff for this file.";
  }
}

function splitFilename(path: string): { dirname: string; basename: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dirname: '', basename: path };
  return { dirname: path.slice(0, slash), basename: path.slice(slash + 1) };
}

function makeOffsetLineNumbers(offset: number): editor.LineNumbersType {
  return (lineNumber: number): string => String(lineNumber + offset - 1);
}

function buildModelPath(filename: string, key: string, side: 'original' | 'modified'): string {
  const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
  return `file:///__inline__/${side}/${encodeURIComponent(key)}/${encodedPath}`;
}

function applyLineNumbers(
  diffEditor: editor.IStandaloneDiffEditor,
  snippet: InlineDiffSnippet,
  expanded: boolean,
): void {
  diffEditor.getOriginalEditor().updateOptions({
    lineNumbers: expanded ? 'on' : makeOffsetLineNumbers(snippet.originalStartLine),
    lineNumbersMinChars: 3,
  });
  diffEditor.getModifiedEditor().updateOptions({
    lineNumbers: expanded ? 'on' : makeOffsetLineNumbers(snippet.modifiedStartLine),
    lineNumbersMinChars: 3,
  });
  diffEditor.layout();
}

function SnippetEditor({
  chunkFilename,
  language,
  snippet,
  expanded,
}: {
  chunkFilename: string;
  language: string;
  snippet: InlineDiffSnippet;
  expanded: boolean;
}) {
  const hydrated = useHydrated();
  const scheme = useComputedColorScheme('dark');
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const disposables = useRef<IDisposable[]>([]);

  const onMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor) => {
      editorRef.current = diffEditor;
      const original = diffEditor.getOriginalEditor();
      const modified = diffEditor.getModifiedEditor();
      const measure = (): void => {
        const contentHeight = Math.max(
          original.getContentHeight(),
          modified.getContentHeight(),
          MIN_EDITOR_HEIGHT - EDITOR_HEIGHT_PADDING,
        );
        setEditorHeight(contentHeight + EDITOR_HEIGHT_PADDING);
      };
      disposables.current = [
        original.onDidContentSizeChange(measure),
        modified.onDidContentSizeChange(measure),
        diffEditor.onDidUpdateDiff(measure),
      ];
      applyLineNumbers(diffEditor, snippet, expanded);
      measure();
    },
    // The mount-time snippet/expanded are right for the first paint; later
    // changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (editorRef.current) applyLineNumbers(editorRef.current, snippet, expanded);
  }, [snippet, expanded]);

  useEffect(
    () => () => {
      for (const disposable of disposables.current) disposable.dispose();
      disposables.current = [];
      /*
       * Tear down in the order Monaco requires: detach the models from the
       * widget, then dispose them. @monaco-editor/react 4.7 does it the other
       * way round — disposes both models, then the widget — and Monaco 0.55
       * throws "TextModel got disposed before DiffEditorWidget model got
       * reset" on every unmount. So the library is told to keep the models
       * (`keepCurrent*Model` below) and this owns them instead.
       *
       * The ordering holds because React runs a deleted tree's effect
       * cleanups parent first: this runs before the library's own cleanup,
       * which then finds no model and disposes only the widget.
       */
      const diffEditor = editorRef.current;
      editorRef.current = null;
      if (!diffEditor) return;
      const model = diffEditor.getModel();
      diffEditor.setModel(null);
      model?.original.dispose();
      model?.modified.dispose();
    },
    [],
  );

  // Click anywhere on the "N hidden lines" centre text to unfold it.
  const onClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const center = target.closest('.diff-hidden-lines .center');
    if (!center || target.closest('a[role="button"], .breadcrumb-item')) return;
    center.querySelector<HTMLElement>('a[role="button"]')?.click();
  }, []);

  // Memoised so the library only re-applies options when `expanded` flips;
  // a fresh object each render would reset the per-side line numbers set by
  // `applyLineNumbers` on every height measurement.
  const options = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
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
      scrollbar: { vertical: 'hidden', horizontal: 'auto', handleMouseWheel: false },
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
    }),
    [expanded],
  );

  const fallback = <Skeleton height={MIN_EDITOR_HEIGHT} radius={0} />;
  return (
    <div className={classes.editor} style={{ height: editorHeight }} onClick={onClick}>
      {hydrated ? (
        <Suspense fallback={fallback}>
          <DiffEditor
            original={snippet.original}
            modified={snippet.modified}
            language={language}
            originalLanguage={language}
            modifiedLanguage={language}
            originalModelPath={buildModelPath(chunkFilename, snippet.key, 'original')}
            modifiedModelPath={buildModelPath(chunkFilename, snippet.key, 'modified')}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
            onMount={onMount}
            loading={fallback}
            options={options}
          />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}

/**
 * One file's reviewer-selected hunks: both blobs come from `/api/github/file`
 * in one round trip, are sliced to the lines around each hunk group
 * (`buildInlineDiffSnippets`) and shown in one Monaco `DiffEditor` per group;
 * "Show full file" swaps in the whole pair. A rejected token never reaches
 * here — the loader redirects to `/relink` and the fetcher follows.
 */
export function InlineDiffChunk({
  chunk,
  owner,
  repo,
  baseRef,
  headRef,
}: {
  chunk: DiffChunk;
  owner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}) {
  const fetcher = useFetcher<FileResponse>();
  const load = fetcher.load;
  const href = `/api/github/file?${new URLSearchParams({
    owner,
    repo,
    path: chunk.filename,
    base: baseRef,
    head: headRef,
  }).toString()}`;
  useEffect(() => {
    void load(href);
  }, [load, href]);

  const [expanded, setExpanded] = useState(false);
  const state = useMemo(
    () => resolveFileState(fetcher.data, chunk.filename),
    [fetcher.data, chunk.filename],
  );

  const snippets = useMemo<InlineDiffSnippet[]>(() => {
    if (state.kind !== 'ok') return [];
    if (expanded) return [fullFile('full-file', state.data)];
    const collapsed = buildInlineDiffSnippets({
      hunks: chunk.hunks,
      original: state.data.original,
      modified: state.data.modified,
      originalLineCount: state.data.originalLineCount,
      modifiedLineCount: state.data.modifiedLineCount,
      contextLines: CONTEXT_LINES,
    });
    return collapsed.length > 0 ? collapsed : [fullFile('fallback-full-file', state.data)];
  }, [state, expanded, chunk.hunks]);

  const language = state.kind === 'ok' ? state.data.language : chunk.language;
  const { dirname, basename } = splitFilename(chunk.filename);

  return (
    <Box
      role="figure"
      aria-label={`Diff for ${chunk.filename}`}
      style={{
        overflow: 'hidden',
        borderRadius: 8,
        boxShadow: `0 0 0 1px ${token('border')}`,
        background: token('card'),
      }}
    >
      <Group
        gap={8}
        px={12}
        py={8}
        fz="sm"
        style={{
          borderBottom: `1px solid ${token('border')}`,
          background: `color-mix(in oklab, ${token('muted')} 30%, transparent)`,
        }}
      >
        <Text
          component="span"
          ff="monospace"
          fz="inherit"
          miw={0}
          style={{ wordBreak: 'break-all' }}
        >
          {dirname.length > 0 && (
            <Text component="span" fz="xs" c="dimmed">
              {dirname}/
            </Text>
          )}
          <Text component="span" fz="sm" fw={600}>
            {basename}
          </Text>
        </Text>
        <Text
          component="span"
          fz="inherit"
          px={6}
          py={2}
          c="dimmed"
          style={{ borderRadius: 4, background: token('muted') }}
        >
          {language}
        </Text>
        {state.kind === 'ok' && (
          <UnstyledButton
            ml="auto"
            px={8}
            py={2}
            fz="sm"
            c="dimmed"
            style={{ borderRadius: 4 }}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? 'Show changes only' : 'Show full file'}
          </UnstyledButton>
        )}
      </Group>

      {state.kind === 'loading' && (
        <Text px={12} py={16} fz="sm" c="dimmed">
          Loading…
        </Text>
      )}
      {state.kind === 'error' && (
        <Text px={12} py={16} fz="sm" c="dimmed">
          {describeError(state.error)}
        </Text>
      )}
      {state.kind === 'ok' &&
        snippets.map((snippet) => (
          <SnippetEditor
            key={snippet.key}
            chunkFilename={chunk.filename}
            language={language}
            snippet={snippet}
            expanded={expanded}
          />
        ))}
    </Box>
  );
}
