import { Box, Group, Skeleton, Text, UnstyledButton } from '@mantine/core';
import type { editor, IDisposable, IRange } from 'monaco-editor';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FilePair } from '@/review/bundle';
import {
  buildInlineDiffSnippets,
  skimRanges,
  type InlineDiffSnippet,
  type LineRange,
} from '@/report/reader/inline-diff-snippets';
import { factTags, hunkMarks, type HunkMark } from '@/report/reader/hunk-marks';
import { detectLanguage } from '@/review/language-map';
import type {
  CitedHunk,
  DiffChunk,
  DiffLineSpan,
  Insight,
  JudgementCall,
} from '@/review/narrative';
import { originVerb } from '@/report/reader/file-origin';
import { useFilePair, useReviewFile } from '@/report/reader/file-source';
import { InsightCallout, JudgementCallout } from '@/report/reader/insight-callout';
import {
  DiffEditor,
  EDITOR_HEIGHT_PADDING,
  lineNumberWidth,
  makeOffsetLineNumbers,
  MIN_EDITOR_HEIGHT,
  useEditorTheme,
  useLayoutOnColumnSettle,
  useScrollKeptOnFocus,
} from '@/report/reader/monaco-editors';
import {
  selectSpaceLimited,
  SIDE_BY_SIDE_MIN_WIDTH,
  useDiffView,
  useReaderColumn,
  type DiffView,
} from '@/report/stores/diff-view';
import { useDiffWrap, type DiffWrap } from '@/report/stores/diff-wrap';
import { useSkimMarks, type SkimMarks } from '@/report/stores/skim-marks';
import { token, TOPBAR_HEIGHT } from '@/report/theme/tokens';
import classes from './inline-diff-chunk.module.css';

const CONTEXT_LINES = 5;

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

/** The whole pair, still carrying the chapter's hunks so its skim lines stay faded. */
function fullFile(key: string, data: FileData, hunks: readonly CitedHunk[]): InlineDiffSnippet {
  return {
    key,
    original: data.original,
    modified: data.modified,
    originalStartLine: 1,
    modifiedStartLine: 1,
    hunks,
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

/**
 * Whole lines, to the end of the last one. The text is faded, and the line
 * and its gutter are washed toward the editor's background, so the diff's own
 * band, rail and line number recede with the text rather than staying at full
 * strength around it: a bright band behind faded text still draws the eye.
 * The reason is the region's label, not a hover.
 */
function skimDecorations(
  model: editor.ITextModel | null,
  ranges: readonly LineRange[],
): editor.IModelDeltaDecoration[] {
  if (!model) return [];
  const last = model.getLineCount();
  return ranges.flatMap(([start, end]) => {
    if (start > last) return [];
    const range: IRange = {
      startLineNumber: start,
      startColumn: 1,
      endLineNumber: Math.min(end, last),
      endColumn: model.getLineMaxColumn(Math.min(end, last)),
    };
    return [
      {
        range,
        options: {
          isWholeLine: true,
          inlineClassName: classes.skim,
          className: classes.skimWash,
          marginClassName: classes.skimWash,
        },
      },
    ];
  });
}

/**
 * Fades each side's skim lines when the reader has asked for skim marks.
 * Decorations rather than a separate editor per tier, so a file stays one
 * piece.
 *
 * The stacked view draws deleted lines as view zones inside the modified
 * editor, which the original editor's decorations do not reach, so there a
 * skim hunk's removed lines keep full strength. They carry the removed band,
 * and fading them would need Monaco's private zone DOM.
 */
function applySkimFade(
  diffEditor: editor.IStandaloneDiffEditor,
  snippet: InlineDiffSnippet,
  marks: SkimMarks,
  collections: { current: editor.IEditorDecorationsCollection[] },
): void {
  for (const collection of collections.current) collection.clear();
  collections.current = [];
  if (marks === 'plain') return;
  const ranges = skimRanges(snippet);
  const original = diffEditor.getOriginalEditor();
  const modified = diffEditor.getModifiedEditor();
  collections.current = [
    original.createDecorationsCollection(skimDecorations(original.getModel(), ranges.original)),
    modified.createDecorationsCollection(skimDecorations(modified.getModel(), ranges.modified)),
  ];
}

/** Where a labelled region sits in the editor, in pixels from its top. */
interface MarkBox {
  mark: HunkMark;
  top: number;
  height: number;
}

/**
 * One side of a hunk, as pixels in that side's editor. Stacked, the modified
 * editor also holds the removed lines, as view zones: those just above the
 * hunk's first line or just below its last are its own, and a side with no
 * lines at all is the zone after the line git names. Side by side, those zones
 * are the other pane's filler, and the other side is measured instead.
 */
function spanBox(
  sideEditor: editor.ICodeEditor,
  span: DiffLineSpan,
  snippetStart: number,
  stacked: boolean,
): [top: number, bottom: number] | null {
  const lineCount = sideEditor.getModel()?.getLineCount() ?? 0;
  const first = span.startLine - snippetStart + 1;
  if (span.lineCount <= 0) {
    if (!stacked) return null;
    const top = first >= 1 ? sideEditor.getBottomForLineNumber(Math.min(first, lineCount)) : 0;
    const bottom =
      first < lineCount ? sideEditor.getTopForLineNumber(first + 1) : sideEditor.getContentHeight();
    return [top, bottom];
  }
  const last = Math.min(first + span.lineCount - 1, lineCount);
  const top = sideEditor.getTopForLineNumber(first, stacked);
  const bottom =
    stacked && last < lineCount
      ? sideEditor.getTopForLineNumber(last + 1)
      : sideEditor.getBottomForLineNumber(last);
  return [top, bottom];
}

function markBoxes(
  diffEditor: editor.IStandaloneDiffEditor,
  snippet: InlineDiffSnippet,
  marks: readonly HunkMark[],
  view: DiffView,
): MarkBox[] {
  const stacked = view === 'unified';
  const original = diffEditor.getOriginalEditor();
  const modified = diffEditor.getModifiedEditor();
  return marks.flatMap((mark) => {
    const boxes = mark.hunks
      .flatMap((hunk) => [
        spanBox(modified, hunk.modified, snippet.modifiedStartLine, stacked),
        stacked ? null : spanBox(original, hunk.original, snippet.originalStartLine, false),
      ])
      .filter((box) => box !== null);
    if (boxes.length === 0) return [];
    const top = Math.min(...boxes.map(([start]) => start));
    const bottom = Math.max(...boxes.map(([, end]) => end));
    return bottom > top ? [{ mark, top, height: bottom - top }] : [];
  });
}

function sameBoxes(a: readonly MarkBox[], b: readonly MarkBox[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (box, i) => box.mark === b[i]!.mark && box.top === b[i]!.top && box.height === b[i]!.height,
    )
  );
}

/**
 * Each labelled region as a rule down the editor's right edge with its label
 * at the top: right rather than left, where code is least likely to run, and
 * over the editor rather than in a view zone, which would push the lines
 * apart. Placed from the editors' own line geometry, which the reader never
 * scrolls vertically, so a measure after each layout keeps it in place.
 */
function MarkOverlay({ boxes }: { boxes: readonly MarkBox[] }) {
  return (
    <div className={classes.marks}>
      {boxes.map(({ mark, top, height }) => (
        <div key={mark.key} className={classes.mark} style={{ top, height }}>
          <span className={classes.markLabel} title={mark.detail}>
            {mark.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function SnippetEditor({
  chunkFilename,
  language,
  snippet,
  expanded,
  view,
  wrap,
  skimMarks,
}: {
  chunkFilename: string;
  language: string;
  snippet: InlineDiffSnippet;
  expanded: boolean;
  view: DiffView;
  wrap: DiffWrap;
  skimMarks: SkimMarks;
}) {
  const theme = useEditorTheme();
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [boxes, setBoxes] = useState<MarkBox[]>([]);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const disposables = useRef<IDisposable[]>([]);
  const skimFade = useRef<editor.IEditorDecorationsCollection[]>([]);
  const marks = useMemo(
    () => (skimMarks === 'marked' ? hunkMarks(snippet.hunks) : []),
    [skimMarks, snippet.hunks],
  );
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
  // Mirrored for the frozen `measure`, as `viewRef` is.
  const snippetRef = useRef(snippet);
  snippetRef.current = snippet;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const skimMarksRef = useRef(skimMarks);
  skimMarksRef.current = skimMarks;

  const measureMarks = useCallback(() => {
    const diffEditor = editorRef.current;
    if (!diffEditor) return;
    const next = markBoxes(diffEditor, snippetRef.current, marksRef.current, viewRef.current);
    setBoxes((previous) => (sameBoxes(previous, next) ? previous : next));
  }, []);

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
        measureMarks();
      };
      disposables.current = [
        original.onDidContentSizeChange(measure),
        modified.onDidContentSizeChange(measure),
        diffEditor.onDidUpdateDiff(measure),
        modified.onDidLayoutChange(measureMarks),
      ];
      applyWordWrap(diffEditor, wrapRef.current);
      applySnippetLayout(diffEditor, snippet, expanded);
      applySkimFade(diffEditor, snippet, skimMarksRef.current, skimFade);
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

  useEffect(() => {
    if (editorRef.current) applySkimFade(editorRef.current, snippet, skimMarks, skimFade);
  }, [snippet, skimMarks]);

  // A flip of the view or the marks moves the lines after this render; the
  // editors have laid out again by the next frame.
  useEffect(() => {
    measureMarks();
    const frame = requestAnimationFrame(measureMarks);
    return () => cancelAnimationFrame(frame);
  }, [measureMarks, marks, view, wrap, expanded]);

  // `view` belongs here because Monaco re-pins the original editor's
  // `wordWrapOverride2` on every pass through the stacked view.
  useEffect(() => {
    if (editorRef.current) applyWordWrap(editorRef.current, wrap);
  }, [wrap, view]);

  useLayoutOnColumnSettle(editorRef);

  useEffect(
    () => () => {
      for (const disposable of disposables.current) disposable.dispose();
      disposables.current = [];
      for (const collection of skimFade.current) collection.clear();
      skimFade.current = [];
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

  const keepScroll = useScrollKeptOnFocus();

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
      // Monaco ignores this in the unified view, and a move is only found when
      // both ends sit inside the same snippet or the full file is shown.
      experimental: { showMoves: true },
    }),
    [expanded, view],
  );

  const fallback = <Skeleton height={MIN_EDITOR_HEIGHT} radius={0} />;
  return (
    <div
      className={classes.editor}
      style={{ height: editorHeight }}
      onClick={onClick}
      onPointerDown={keepScroll.onPointerDown}
      onFocus={keepScroll.onFocus}
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
          theme={theme}
          onMount={onMount}
          loading={fallback}
          options={options}
        />
      </Suspense>
      {boxes.length > 0 && <MarkOverlay boxes={boxes} />}
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
 * The frame every code card in a chapter shares, a diff's or an excerpt's,
 * so the two read as one kind of thing. Only a diff names its file in
 * `data-diff-file`, which the sidebar reads to mark the changed file being
 * read; an excerpt's file is not in that list.
 */
export function CodeCard({
  label,
  diffFile,
  children,
}: {
  label: string;
  diffFile?: string;
  children: ReactNode;
}) {
  return (
    <Box
      role="figure"
      aria-label={label}
      data-diff-file={diffFile}
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
      {children}
    </Box>
  );
}

/** A code card's path, stuck under the topbar, then whatever the card adds beside it. */
export function CodeCardHeader({ filename, children }: { filename: string; children: ReactNode }) {
  const { dirname, basename } = splitFilename(filename);
  return (
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
      <Text component="span" ff="monospace" fz="inherit" miw={0} style={{ wordBreak: 'break-all' }}>
        {dirname.length > 0 && (
          <Text component="span" fz="xs" c="dimmed">
            {dirname}/
          </Text>
        )}
        <Text component="span" fz="sm" fw={600}>
          {basename}
        </Text>
      </Text>
      {children}
    </Group>
  );
}

/**
 * One file's reviewer-selected hunks: both sides come from the bundle through
 * `useFilePair`, are sliced to the lines around
 * each hunk group (`buildInlineDiffSnippets`) and shown in one Monaco
 * `DiffEditor` per group; "Show full file" swaps in the whole pair.
 *
 * A group is consecutive hunks whatever their tiers. With skim marks on, a
 * skim hunk's lines are faded in place, never folded, so every line a chapter
 * cites is on the page, and it and every hunk with a proven fact are labelled
 * at the editor's right edge. What the CLI proved is also tagged in the
 * header, one tag per fact with all the lines it holds for.
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
  const file = useReviewFile(chunk.filename);
  const stored = useDiffView((s) => s.view);
  const wrap = useDiffWrap((s) => s.wrap);
  const skimMarks = useSkimMarks((s) => s.marks);
  const spaceLimited = useReaderColumn(selectSpaceLimited);
  // Too narrow for two panes is not a preference the column can honour.
  const view: DiffView = spaceLimited ? 'unified' : stored;
  const [expanded, setExpanded] = useState(false);
  const state = useMemo(() => resolveFileState(pair, chunk.filename), [pair, chunk.filename]);

  const snippets = useMemo<InlineDiffSnippet[]>(() => {
    if (state.kind !== 'ok') return [];
    if (expanded) return [fullFile('full-file', state.data, chunk.hunks)];
    const collapsed = buildInlineDiffSnippets({
      hunks: chunk.hunks,
      original: state.data.original,
      modified: state.data.modified,
      originalLineCount: state.data.originalLineCount,
      modifiedLineCount: state.data.modifiedLineCount,
      contextLines: CONTEXT_LINES,
      fileHunks: file?.hunks,
    });
    return collapsed.length > 0
      ? collapsed
      : [fullFile('fallback-full-file', state.data, chunk.hunks)];
  }, [state, expanded, chunk.hunks, file?.hunks]);

  const language = state.kind === 'ok' ? state.data.language : chunk.language;
  const tags = useMemo(() => factTags(chunk.hunks), [chunk.hunks]);

  return (
    <CodeCard label={`Diff for ${chunk.filename}`} diffFile={chunk.filename}>
      <CodeCardHeader filename={chunk.filename}>
        {file?.origin && (
          <Text component="span" fz="xs" c="dimmed" miw={0} style={{ wordBreak: 'break-all' }}>
            {originVerb(file).toLowerCase()}{' '}
            <Text component="span" ff="monospace" fz="inherit">
              {file.origin.filename}
            </Text>
          </Text>
        )}
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
        {tags.map((tag) => (
          <Text
            key={tag.label}
            component="span"
            fz="xs"
            c="dimmed"
            px={6}
            py={1}
            title={tag.detail}
            style={{ borderRadius: 4, border: `1px solid ${token('border')}` }}
          >
            {tag.label} · {tag.lines}
          </Text>
        ))}
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
      </CodeCardHeader>

      {(insights.length > 0 || judgementCalls.length > 0) && (
        <AnchoredAsides insights={insights} judgementCalls={judgementCalls} />
      )}

      {state.kind === 'unavailable' && (
        <Text px={12} py={16} fz="sm" c="dimmed">
          {UNAVAILABLE[state.reason]}
        </Text>
      )}
      {state.kind === 'ok' &&
        snippets.map((snippet, index) => (
          <Box
            key={snippet.key}
            style={index > 0 ? { borderTop: `1px solid ${token('border')}` } : undefined}
          >
            <SnippetEditor
              chunkFilename={chunk.filename}
              language={language}
              snippet={snippet}
              expanded={expanded}
              view={view}
              wrap={wrap}
              skimMarks={skimMarks}
            />
          </Box>
        ))}
    </CodeCard>
  );
}
