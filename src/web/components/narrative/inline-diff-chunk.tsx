import { Box, Group, Skeleton, Text, UnstyledButton, useComputedColorScheme } from '@mantine/core';
import type { editor, IDisposable } from 'monaco-editor';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileAtRef, GithubError, GithubResult } from '@/domain/github/types';
import type { FilePair } from '@/domain/review/bundle';
import {
  buildInlineDiffSnippets,
  type InlineDiffSnippet,
} from '@/domain/review/inline-diff-snippets';
import { detectLanguage } from '@/domain/review/language-map';
import type { DiffChunk } from '@/domain/review/narrative';
import { useFilePair } from '@/web/components/narrative/file-source';
import { useHydrated } from '@/web/lib/use-hydrated';
import {
  selectSpaceLimited,
  SIDE_BY_SIDE_MIN_WIDTH,
  useDiffView,
  useReaderColumn,
  type DiffView,
} from '@/web/stores/diff-view';
import { useDiffWrap, type DiffWrap } from '@/web/stores/diff-wrap';
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
/**
 * How long the measured column has to hold still before the editors are laid
 * out against it. The width arrives about once an animation frame for as long
 * as the sidebar handle is dragged or the window edge held, and a relayout
 * reflows every line of every editor on the page — so this is the trailing edge
 * of a drag, not a frame of it. Long enough to coalesce a drag, short enough
 * that a reader who lets go does not watch the diff catch up.
 */
const COLUMN_SETTLE_MS = 120;

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
 * (the viewer lost the repo, the SHAs are gone, or the bundle does not carry
 * the file); one `not-found` is a file added or deleted on that side, shown
 * against empty content.
 */
function resolveFileState(body: FilePair | undefined, filename: string): FetchState {
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
      return "This file isn't available at either commit.";
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

/**
 * The per-side line numbers for a snippet, and then a relayout.
 *
 * The relayout is the point as much as the numbers are. Both the gutter width
 * and — when the split/unified view flips — the inner editors' heights are
 * stale until the widget is told to lay out again, and `automaticLayout` never
 * catches the second one: the container it watches is sized from the measured
 * content, so it has not changed when the content inside it has. Left alone
 * after a flip, the modified editor keeps its side-by-side height while its
 * content grows by the deleted lines, and those last lines end up below a
 * viewport with no way to reach them — the vertical scrollbar is hidden and
 * the wheel is detached.
 */
function applySnippetLayout(
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

/**
 * Soft wrapping, set on the live widget rather than through its construction
 * options: those are re-applied wholesale when the object changes, which would
 * undo the per-side line numbers `applySnippetLayout` just set.
 *
 * `diffWordWrap` is the lever for both sides. Monaco hands it to each inner
 * editor as `wordWrapOverride1`, which outranks that editor's own `wordWrap`
 * unless it is left at `inherit`, so setting `wordWrap` beside it would decide
 * nothing. It reaches the modified editor under either render mode, and that is
 * the one that matters: stacked, the original editor is force-unwrapped, but
 * the deleted lines a reader sees there are not drawn by it — they are view
 * zones inside the modified editor, and their line breaks are computed by the
 * modified editor's own view model, so they wrap by the setting that has
 * already arrived.
 */
function applyWordWrap(diffEditor: editor.IStandaloneDiffEditor, wrap: DiffWrap): void {
  diffEditor.updateOptions({ diffWordWrap: wrap });
  /*
   * `wordWrapOverride2` outranks the `wordWrapOverride1` that `diffWordWrap`
   * sets, and Monaco pins it to `off` on the original editor every time it
   * computes that side's options while rendering inline — including at
   * construction, where the widget measures a container the browser has not
   * laid out yet and takes the resulting zero width for a column too narrow to
   * carry two panes. Settling into side by side rewrites override 1 and leaves
   * override 2 pinned, so without this the original pane never wraps, however
   * often `diffWordWrap` is re-applied.
   */
  diffEditor.getOriginalEditor().updateOptions({ wordWrapOverride2: 'inherit' });
  // Wrapping changes the inner editors' heights without changing the container
  // `automaticLayout` watches — the same blind spot `applySnippetLayout` ends
  // on, and the same fix.
  diffEditor.layout();
}

function SnippetEditor({
  chunkFilename,
  language,
  snippet,
  expanded,
  view,
  wrap,
}: {
  chunkFilename: string;
  language: string;
  snippet: InlineDiffSnippet;
  expanded: boolean;
  view: DiffView;
  wrap: DiffWrap;
}) {
  const hydrated = useHydrated();
  const scheme = useComputedColorScheme('dark');
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const disposables = useRef<IDisposable[]>([]);
  /*
   * `measure` below is frozen at mount but has to know the current view, and
   * it has to know it early: the editor library applies the new options from
   * its own effect, which — being a child's — runs before this component's,
   * and the content-size event that fires there is what triggers the measure.
   * Mirroring during render is what puts the fresh value in front of it;
   * updating in an effect leaves every flip measured against the old view.
   */
  const viewRef = useRef(view);
  viewRef.current = view;
  /*
   * Mirrored during render too, because `onMount` is frozen at mount but runs
   * whenever the lazy Monaco chunk finally arrives — potentially several
   * renders later. Reading the captured value there would apply whatever the
   * preference was when this component first rendered, and the effect below,
   * having already run against the current one, would never correct it.
   */
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;

  const onMount = useCallback(
    (diffEditor: editor.IStandaloneDiffEditor) => {
      editorRef.current = diffEditor;
      const original = diffEditor.getOriginalEditor();
      const modified = diffEditor.getModifiedEditor();
      const measure = (): void => {
        /*
         * Only the modified editor is on screen in the unified view, and it
         * holds the whole diff — the original is collapsed to its gutter but
         * still reports a content height a line or so taller than what is
         * drawn, so taking the max of both sides there pads every stacked diff
         * with dead space. Side by side, both are visible and the taller one
         * sets the height.
         */
        const contentHeight = Math.max(
          viewRef.current === 'split' ? original.getContentHeight() : 0,
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
      applyWordWrap(diffEditor, wrapRef.current);
      applySnippetLayout(diffEditor, snippet, expanded);
      measure();
    },
    // The mount-time snippet/expanded are right for the first paint; later
    // changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // `view` belongs here for the relayout, not for the line numbers — see
  // `applySnippetLayout`.
  useEffect(() => {
    if (editorRef.current) applySnippetLayout(editorRef.current, snippet, expanded);
  }, [snippet, expanded, view]);

  // `view` belongs here because Monaco re-pins the original editor's
  // `wordWrapOverride2` on every pass through the stacked view.
  useEffect(() => {
    if (editorRef.current) applyWordWrap(editorRef.current, wrap);
  }, [wrap, view]);

  /*
   * The column the reader gives this diff is the one width `automaticLayout`
   * cannot see — the blind spot `applySnippetLayout` describes — and nothing
   * else here notices it: a window resize that does not cross
   * `SIDE_BY_SIDE_MIN_WIDTH` changes no snippet, no flag and no preference.
   * Unwrapped that only left a stale horizontal scrollbar; wrapped, the wrap
   * column is stale too, so lines break at a width the pane no longer has and
   * the overflow is clipped rather than scrollable.
   *
   * Subscribed to rather than read as state: the width arrives once a frame for
   * as long as a drag lasts, and a hook would put every editor on the page
   * through a render for each of them.
   */
  useEffect(() => {
    let settled: number | undefined;
    const unsubscribe = useReaderColumn.subscribe((state, previous) => {
      if (state.columnWidth === previous.columnWidth || state.columnWidth === null) return;
      window.clearTimeout(settled);
      settled = window.setTimeout(() => editorRef.current?.layout(), COLUMN_SETTLE_MS);
    });
    return () => {
      window.clearTimeout(settled);
      unsubscribe();
    };
  }, []);

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

  // Memoised so the library only re-applies options when `expanded` or the
  // view flips; a fresh object each render would reset the per-side line
  // numbers set by `applySnippetLayout` on every height measurement.
  const options = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      readOnly: true,
      renderSideBySide: view === 'split',
      /*
       * The reader's own measurement has already forced `view` to unified in a
       * column this narrow, so this agrees rather than decides — it is the
       * backstop for a diff mounted somewhere that measures nothing, and it
       * reads the same threshold so the two can never part company.
       *
       * Minus one because the two comparisons point opposite ways: the store
       * treats `SIDE_BY_SIDE_MIN_WIDTH` as wide enough, while Monaco goes
       * inline at `width <= renderSideBySideInlineBreakpoint`. Passing the
       * constant itself would collapse the editor at exactly 900px while the
       * toggle still said side by side.
       */
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: SIDE_BY_SIDE_MIN_WIDTH - 1,
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
    [expanded, view],
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
 * One file's reviewer-selected hunks: both sides come from the surrounding
 * `FileSource` (GitHub or an embedded bundle), are sliced to the lines around
 * each hunk group (`buildInlineDiffSnippets`) and shown in one Monaco
 * `DiffEditor` per group; "Show full file" swaps in the whole pair.
 */
export function InlineDiffChunk({ chunk }: { chunk: DiffChunk }) {
  const pair = useFilePair(chunk.filename);
  const stored = useDiffView((s) => s.view);
  const wrap = useDiffWrap((s) => s.wrap);
  const spaceLimited = useReaderColumn(selectSpaceLimited);
  // Too narrow for two panes is not a preference the column can honour.
  const view: DiffView = spaceLimited ? 'unified' : stored;
  const [expanded, setExpanded] = useState(false);
  const state = useMemo(() => resolveFileState(pair, chunk.filename), [pair, chunk.filename]);

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
            view={view}
            wrap={wrap}
          />
        ))}
    </Box>
  );
}
