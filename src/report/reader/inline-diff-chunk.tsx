import { Box, Group, Skeleton, Text, UnstyledButton, useComputedColorScheme } from '@mantine/core';
import type { DiffEditorProps } from '@monaco-editor/react';
import type { editor, IDisposable } from 'monaco-editor';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import type { FilePair } from '@/review/bundle';
import {
  buildInlineDiffSnippets,
  type InlineDiffSnippet,
} from '@/report/reader/inline-diff-snippets';
import { detectLanguage } from '@/review/language-map';
import type { DiffChunk, Insight, JudgementCall } from '@/review/narrative';
import { useFilePair } from '@/report/reader/file-source';
import { InsightCallout, JudgementCallout } from '@/report/reader/insight-callout';
import { MONACO_VS_URL } from '@/report/reader/monaco-cdn';
import {
  selectSpaceLimited,
  SIDE_BY_SIDE_MIN_WIDTH,
  useDiffView,
  useReaderColumn,
  type DiffView,
} from '@/report/stores/diff-view';
import { useDiffWrap, type DiffWrap } from '@/report/stores/diff-wrap';
import { token, TOPBAR_HEIGHT } from '@/report/theme/tokens';
import classes from './inline-diff-chunk.module.css';

/**
 * Stands in for a diff whose editor never arrived. The reader is told what is
 * missing and what to try, because the alternative — and what this replaced —
 * is a card with a header and an empty body, which reads as a file with no
 * changes in it rather than as a failure.
 *
 * It names no library: "Monaco" is not a word the recipient of a review has
 * any reason to know. Reloading is named in prose rather than offered as a
 * button, matching the report's other failure surface; a control inside a
 * diff strip that silently reloads the whole page is a bigger action than it
 * would look.
 */
function DiffUnavailable() {
  return (
    <Box px={12} py={10}>
      <Text fz="sm" c="dimmed">
        The code viewer didn&rsquo;t load, so this diff can&rsquo;t be shown. Reloading the page may
        fix it.
      </Text>
    </Box>
  );
}

/**
 * Monaco is loaded lazily, so the report paints before the editor arrives.
 *
 * Pointing the CDN at the declared version happens here, rather than as a
 * side effect of importing `monaco-cdn.ts`, so that the loader ships with the
 * editor instead of riding in the initial bundle — and so that the pin is a
 * call someone can see, not an import that looks unused. `lazy` runs its
 * factory once, so the configuration is in place before anything reads it.
 *
 * `init` is awaited here rather than left to the editor because this is the
 * only place its failure can be caught. The library calls it on mount, logs
 * whatever it rejects with and renders nothing further, so the failure
 * reaches no error boundary — a rejected promise is not a throw — and every
 * diff on the page was left an empty box with no explanation. Awaiting it
 * here makes "the editor is unavailable" a question of which component
 * `lazy` resolves to, which is answerable.
 *
 * One "Uncaught (in promise)" survives in the console and is not ours to
 * catch: `makeCancelable` in `@monaco-editor/loader` calls `.then(onFulfilled)`
 * with no rejection handler beside its `.catch`, so the promise that derives
 * from leaks once per `init`. What did go is the library's own
 * "Monaco initialization: error" — the editor is never mounted now, so it
 * never makes the call that would log it.
 */
const DiffEditor = lazy<ComponentType<DiffEditorProps>>(async () => {
  const mod = await import('@monaco-editor/react');
  mod.loader.config({ paths: { vs: MONACO_VS_URL } });
  try {
    await mod.loader.init();
  } catch {
    return { default: DiffUnavailable };
  }
  return { default: mod.DiffEditor };
});

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

/** How long a pointerdown's scroll offset stays good for the focus it expects. */
const PENDING_SCROLL_MS = 300;

interface FileData {
  original: string;
  modified: string;
  originalLineCount: number;
  modifiedLineCount: number;
  language: string;
}

type FileState =
  { kind: 'ok'; data: FileData } | { kind: 'unavailable'; reason: 'absent' | 'too-large' };

/**
 * The state machine over the two sides: both absent means the bundle does not
 * carry the file; one absent is a file added or deleted on that side, shown
 * against empty content.
 */
function resolveFileState({ base, head }: FilePair, filename: string): FileState {
  if (base.kind === 'too-large' || head.kind === 'too-large') {
    return { kind: 'unavailable', reason: 'too-large' };
  }
  if (base.kind === 'absent' && head.kind === 'absent') {
    return { kind: 'unavailable', reason: 'absent' };
  }
  return {
    kind: 'ok',
    data: {
      original: base.kind === 'content' ? base.content : '',
      modified: head.kind === 'content' ? head.content : '',
      originalLineCount: base.kind === 'content' ? base.lineCount : 0,
      modifiedLineCount: head.kind === 'content' ? head.lineCount : 0,
      language:
        base.kind === 'content'
          ? base.language
          : head.kind === 'content'
            ? head.language
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

const UNAVAILABLE: Record<'absent' | 'too-large', string> = {
  absent: "This file isn't available at either commit.",
  'too-large': 'This file is too large to preview inline.',
};

function splitFilename(path: string): { dirname: string; basename: string } {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return { dirname: '', basename: path };
  return { dirname: path.slice(0, slash), basename: path.slice(slash + 1) };
}

function makeOffsetLineNumbers(offset: number): editor.LineNumbersType {
  return (lineNumber: number): string => String(lineNumber + offset - 1);
}

/**
 * How wide to hold a side's line-number column, in characters.
 *
 * Monaco sizes that column from the model it was handed, but a collapsed
 * snippet's model starts again at 1 while the numbers drawn over it are the
 * file's own — so a twenty-line snippet lifted from line 176 is measured for
 * two digits and asked to paint three, and the number ends up flush against
 * the edge of the gutter with nothing either side of it. Measuring the largest
 * number actually rendered is what keeps the column honest.
 *
 * The extra character is the breathing room: Monaco right-aligns the digits in
 * whatever width it is given, so a column sized to exactly fit them leaves no
 * space on the left at all.
 */
function lineNumberWidth(startLine: number, text: string): number {
  const lastLine = startLine + text.split('\n').length - 1;
  return Math.max(3, String(lastLine).length + 1);
}

function buildModelPath(filename: string, key: string, side: 'original' | 'modified'): string {
  const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
  return `file:///__inline__/${side}/${encodeURIComponent(key)}/${encodedPath}`;
}

/**
 * The per-side gutter for a snippet, and then a relayout.
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
    lineNumbersMinChars: lineNumberWidth(snippet.originalStartLine, snippet.original),
    /*
     * Monaco turns the left side's glyph margin on whenever it renders side by
     * side, to house a fold-unchanged control this reader never shows, and it
     * does so while computing that side's options — so the construction option
     * cannot refuse it and the pane carries an empty strip the right pane does
     * not. Set here because this runs again on a view flip, when it is re-pinned.
     */
    glyphMargin: false,
  });
  diffEditor.getModifiedEditor().updateOptions({
    lineNumbers: expanded ? 'on' : makeOffsetLineNumbers(snippet.modifiedStartLine),
    lineNumbersMinChars: lineNumberWidth(snippet.modifiedStartLine, snippet.modified),
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

  /*
   * Monaco's hidden input carries the caret wherever the mouse puts it, but it
   * starts a click at wherever it was left, and the browser's own "scroll the
   * newly-focused element into view" runs before it catches up — on a page
   * this long, that yanks the whole window to the input's stale position.
   * Capturing the scroll offset on the preceding pointerdown and putting it
   * straight back once focus lands undoes that in the same task, before the
   * browser paints, so the reader never sees the jump. Keyed off pointerdown
   * rather than firing on every focus so a genuine keyboard Tab into the
   * editor keeps the browser's own scroll-into-view.
   *
   * The offset expires because only the focus that follows its own pointerdown
   * may spend it. A press that never lands focus — Monaco still loading behind
   * the skeleton, or a drag released elsewhere — otherwise leaves the offset
   * sitting there, and the next keyboard Tab into this editor scrolls the page
   * back to wherever the reader clicked earlier: the very jump this prevents,
   * on the path it means to leave alone.
   */
  const pendingScroll = useRef<{ x: number; y: number; at: number } | null>(null);
  const onPointerDown = useCallback(() => {
    pendingScroll.current = { x: window.scrollX, y: window.scrollY, at: performance.now() };
  }, []);
  const onFocus = useCallback(() => {
    const pos = pendingScroll.current;
    pendingScroll.current = null;
    if (pos && performance.now() - pos.at < PENDING_SCROLL_MS) window.scrollTo(pos.x, pos.y);
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
      /*
       * No +/- markers. They draw into `lineDecorationsWidth` as an 11px
       * codicon, so a gutter narrow enough to read well clips them, and the row
       * colour already carries added against removed.
       *
       * That width is trailing space inside the gutter, painted with it, so it
       * sets how far the line number sits from the gutter's edge and nothing
       * else — the code's own inset is in this component's stylesheet.
       */
      renderIndicators: false,
      lineDecorationsWidth: 6,
    }),
    [expanded, view],
  );

  const fallback = <Skeleton height={MIN_EDITOR_HEIGHT} radius={0} />;
  return (
    <div
      className={classes.editor}
      style={{ height: editorHeight }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
    >
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
    </div>
  );
}

/**
 * The asides anchored to this file, between the card's header and its diff:
 * the judgement calls first, then the insights.
 *
 * Judgement calls lead because they are the only thing on the page addressed
 * to the reader, and there are at most three in a whole review. Set below a
 * chapter's insights they read as a footnote to them, which is backwards.
 *
 * Capped at the reading measure even though the card itself bleeds to the full
 * column. The diff is what earns the extra width; a sentence set across 1700px
 * does not, and the reader's rule is that prose keeps the measure wherever it
 * appears.
 *
 * Above the diff rather than beside a line: a Monaco view zone would push the
 * lines apart and cost the diff the even rhythm that makes it scannable, which
 * is the whole reason a diff is a diff. This is close enough to be an answer
 * and far enough to leave the code alone.
 */
function AnchoredAsides({
  insights,
  judgementCalls,
}: {
  insights: readonly Insight[];
  judgementCalls: readonly JudgementCall[];
}) {
  return (
    <Box
      px={12}
      py={12}
      maw="var(--er-measure)"
      style={{ borderBottom: `1px solid ${token('border')}` }}
    >
      <Box style={{ display: 'grid', rowGap: 16 }}>
        {judgementCalls.map((call, i) => (
          <JudgementCallout key={`judgement-${String(i)}`} call={call} />
        ))}
        {insights.map((insight, i) => (
          <InsightCallout key={`insight-${String(i)}`} insight={insight} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * One file's reviewer-selected hunks: both sides come from the bundle through
 * `useFilePair`, are sliced to the lines around
 * each hunk group (`buildInlineDiffSnippets`) and shown in one Monaco
 * `DiffEditor` per group; "Show full file" swaps in the whole pair.
 *
 * `insights` are the chapter's insights that named this file, and
 * `judgementCalls` the review's questions this chapter draws for it. The other
 * places a diff appears — the file view, the undiscussed backstop — pass
 * neither: an insight belongs to the chapter that wrote it, and a question is
 * drawn once, by the chapter that owns it.
 */
export function InlineDiffChunk({
  chunk,
  insights = [],
  judgementCalls = [],
}: {
  chunk: DiffChunk;
  insights?: readonly Insight[];
  judgementCalls?: readonly JudgementCall[];
}) {
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
        /*
         * `clip`, not `hidden`: both round the card's corners, but `hidden`
         * makes this box a scroll container, and the header below sticks to
         * the nearest one. Against a card that cannot scroll, its offset
         * resolved to "56px down from the top of the card" and it sat over
         * the first lines of the diff for good.
         */
        overflow: 'clip',
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
          position: 'sticky',
          top: TOPBAR_HEIGHT,
          zIndex: 10,
          borderBottom: `1px solid ${token('border')}`,
          background: `color-mix(in oklab, ${token('muted')} 30%, ${token('card')})`,
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

      {(insights.length > 0 || judgementCalls.length > 0) && (
        <AnchoredAsides insights={insights} judgementCalls={judgementCalls} />
      )}

      {state.kind === 'unavailable' && (
        <Text px={12} py={16} fz="sm" c="dimmed">
          {UNAVAILABLE[state.reason]}
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
