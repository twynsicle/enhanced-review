import { ActionIcon, Box, Skeleton, Text, UnstyledButton } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
} from '@tabler/icons-react';
import type { editor, IDisposable } from 'monaco-editor';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { FilePair } from '@/review/bundle';
import {
  buildInlineDiffSnippets,
  type InlineDiffSnippet,
} from '@/report/reader/inline-diff-snippets';
import { fileHref } from '@/report/reader/hash-params';
import { debugMarks, factTags, hunkMarks, type HunkMark } from '@/report/reader/hunk-marks';
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
  followSelectionInWindow,
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
import { useFileHeaders } from '@/report/stores/file-headers';
import { useHunkDebug, type HunkDebug } from '@/report/stores/hunk-debug';
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
  /** The side a new file (`original`) or a deleted one (`modified`) has nothing on. */
  emptySide: Side | null;
}

type Side = 'original' | 'modified';

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
      emptySide: base.kind === 'absent' ? 'original' : head.kind === 'absent' ? 'modified' : null,
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

function buildModelPath(filename: string, key: string, side: Side): string {
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
  emptySide: Side | null,
): void {
  // A side the file does not exist on has no line to number.
  const numbers = (side: Side, start: number): editor.LineNumbersType =>
    emptySide === side ? 'off' : expanded ? 'on' : makeOffsetLineNumbers(start);
  diffEditor.getOriginalEditor().updateOptions({
    lineNumbers: numbers('original', snippet.originalStartLine),
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
    lineNumbers: numbers('modified', snippet.modifiedStartLine),
    lineNumbersMinChars: lineNumberWidth(snippet.modifiedStartLine, snippet.modified),
    // The cursor sits on a deleted file's one blank line, and would box it.
    renderLineHighlight: emptySide === 'modified' ? 'none' : 'line',
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

/** A rectangle over the editor, in pixels from its top left. */
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where a labelled region sits: its bracket's run down the editor, and the
 * rectangle over each pane's lines that is washed and, while its label is
 * pointed at, outlined.
 */
interface MarkBox {
  mark: HunkMark;
  top: number;
  height: number;
  panes: Rect[];
}

/**
 * One side of a hunk, as pixels in that side's editor. Stacked, the modified
 * editor also holds the removed lines, as view zones: those just above the
 * hunk's first line are its own, as are those just below its last unless the
 * next hunk starts there, and a side with no lines at all is the zone after
 * the line git names. Side by side, those zones are the other pane's filler,
 * and the other side is measured instead.
 */
function spanBox(
  sideEditor: editor.ICodeEditor,
  span: DiffLineSpan,
  snippetStart: number,
  { stacked, ownsBelow }: { stacked: boolean; ownsBelow: boolean },
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
    stacked && ownsBelow && last < lineCount
      ? sideEditor.getTopForLineNumber(last + 1)
      : sideEditor.getBottomForLineNumber(last);
  return [top, bottom];
}

/**
 * Whether the view zones under a hunk's last line are its own: not when the
 * next hunk starts on the line after, or is a deletion sitting after that
 * line, since the zones there hold the next hunk's removed lines.
 */
function ownsZoneBelow(hunk: CitedHunk, hunks: readonly CitedHunk[]): boolean {
  const next = hunks.find((other) => other.fileOrder === hunk.fileOrder + 1);
  if (!next) return true;
  const last = hunk.modified.startLine + hunk.modified.lineCount - 1;
  return next.modified.lineCount > 0
    ? next.modified.startLine !== last + 1
    : next.modified.startLine !== last;
}

/**
 * A pane's left edge and width, in pixels from the editor's own left.
 * Stacked, the one pane is the whole editor: the modified editor starts after
 * a column of the original's line numbers, which belong to its removed lines.
 */
function paneOf(
  sideEditor: editor.ICodeEditor,
  host: HTMLElement,
  stacked: boolean,
): Pick<Rect, 'left' | 'width'> {
  if (stacked) return { left: 0, width: host.clientWidth };
  const pane = sideEditor.getContainerDomNode().getBoundingClientRect();
  return { left: pane.left - host.getBoundingClientRect().left, width: pane.width };
}

/** The extent of several spans, or null when none of them drew anything. */
function extent(spans: readonly ([number, number] | null)[]): [number, number] | null {
  const drawn = spans.filter((span) => span !== null);
  if (drawn.length === 0) return null;
  const top = Math.min(...drawn.map(([start]) => start));
  const bottom = Math.max(...drawn.map(([, end]) => end));
  return bottom > top ? [top, bottom] : null;
}

/**
 * Each mark measured from the editors' own line geometry. The rule and the
 * wash come from the one measurement, so a region the reader is told is skim
 * is always the region that fades.
 */
function markBoxes(
  diffEditor: editor.IStandaloneDiffEditor,
  host: HTMLElement,
  snippet: InlineDiffSnippet,
  marks: readonly HunkMark[],
  view: DiffView,
): MarkBox[] {
  const stacked = view === 'unified';
  const modified = {
    sideEditor: diffEditor.getModifiedEditor(),
    side: 'modified',
    start: snippet.modifiedStartLine,
  } as const;
  const original = {
    sideEditor: diffEditor.getOriginalEditor(),
    side: 'original',
    start: snippet.originalStartLine,
  } as const;
  const sides = stacked ? [modified] : [original, modified];
  return marks.flatMap((mark) => {
    const perSide = sides.map(({ sideEditor, side, start }) => ({
      sideEditor,
      span: extent(
        mark.hunks.map((hunk) =>
          spanBox(sideEditor, hunk[side], start, {
            stacked,
            ownsBelow: ownsZoneBelow(hunk, snippet.hunks),
          }),
        ),
      ),
    }));
    const whole = extent(perSide.map(({ span }) => span));
    if (!whole) return [];
    const panes = perSide.flatMap(({ sideEditor, span }) =>
      span
        ? [{ top: span[0], height: span[1] - span[0], ...paneOf(sideEditor, host, stacked) }]
        : [],
    );
    return [{ mark, top: whole[0], height: whole[1] - whole[0], panes }];
  });
}

/** Pixels cut off the top and the bottom of an editor. */
interface Cut {
  top: number;
  bottom: number;
}

const NO_CUT: Cut = { top: 0, bottom: 0 };

/**
 * Monaco diffs an empty side as its one blank line replaced by the whole file,
 * so a stacked new file opens on a removed blank row — a view zone above its
 * first line — and a deleted file ends on its modified side's one blank line.
 * Neither is a line of the file, so the host cuts it off rather than draw it.
 */
function blankRow(diffEditor: editor.IStandaloneDiffEditor, emptySide: Side | null): Cut {
  const modified = diffEditor.getModifiedEditor();
  if (emptySide === 'original') {
    // Line 1's top with and without the zones directly above it.
    return {
      top: modified.getTopForLineNumber(1) - modified.getTopForLineNumber(1, true),
      bottom: 0,
    };
  }
  if (emptySide === 'modified') {
    return { top: 0, bottom: modified.getBottomForLineNumber(1) - modified.getTopForLineNumber(1) };
  }
  return NO_CUT;
}

/** Boxes measured on the whole editor, moved and trimmed to what the cut leaves on screen. */
function clipBoxes(boxes: readonly MarkBox[], cut: Cut, visible: number): MarkBox[] {
  if (cut.top === 0 && cut.bottom === 0) return [...boxes];
  const clip = <T extends { top: number; height: number }>(box: T): T | null => {
    const top = Math.max(0, box.top - cut.top);
    const bottom = Math.min(visible, box.top + box.height - cut.top);
    return bottom > top ? { ...box, top, height: bottom - top } : null;
  };
  return boxes.flatMap((box) => {
    const clipped = clip(box);
    if (!clipped) return [];
    return [{ ...clipped, panes: box.panes.flatMap((pane) => clip(pane) ?? []) }];
  });
}

function boxesKey(boxes: readonly MarkBox[]): string {
  return JSON.stringify(
    boxes.map(({ mark, top, height, panes }) => [mark.key, top, height, panes]),
  );
}

/**
 * Where each label's top sits: on the line above its region, resting on the
 * bracket's top cap. That line is most often the blank one a split is cut
 * after, so the label covers nothing there, and the bracket already says
 * which lines it is about. Two regions can start on one row — stacked, a
 * hunk's removed lines and the next hunk's first line share a zone — so a
 * label that would cover the one above it moves down below it, its bracket
 * left where it is; and labels pushed past either edge are brought back
 * inside, each clear of its neighbour, since the editor clips what runs past.
 */
function labelTops(sorted: readonly MarkBox[], editorHeight: number): number[] {
  const tops: number[] = [];
  for (const box of sorted) {
    const under = tops.at(-1);
    const above = Math.max(0, box.top - LABEL_BOX);
    tops.push(under === undefined ? above : Math.max(above, under + LABEL_HEIGHT));
  }
  let limit = editorHeight - LABEL_HEIGHT;
  for (let i = tops.length - 1; i >= 0; i -= 1) {
    tops[i] = Math.max(0, Math.min(tops[i]!, limit));
    limit = tops[i]! - LABEL_HEIGHT;
  }
  return tops;
}

/**
 * Each labelled region as a bracket down the editor's right edge with its
 * label at the top, and its lines washed toward the editor's background.
 * Right rather than left, where code is least likely to run, and over the
 * editor rather than in a view zone, which would push the lines apart. The
 * wash is drawn over the editor rather than as Monaco decorations because the
 * stacked view's removed lines are view zones no decoration reaches. Placed
 * from the editors' own line geometry, which the reader never scrolls
 * vertically, so a measure after each layout keeps it in place.
 *
 * The bracket's caps say where a region ends, which a wash alone does not when
 * two regions meet. Pointing at a label outlines its lines as well. No tint:
 * the lines already carry the diff's green or red, and a third colour over
 * those is what the comment fade was made to avoid.
 *
 * A label folds to a tab, to read the code beneath it; the fold lasts as long
 * as the diff is on the page.
 */
function MarkOverlay({
  boxes,
  editorHeight,
  ground,
}: {
  boxes: readonly MarkBox[];
  editorHeight: number;
  /** The editor's own background, which the wash fades the lines toward. */
  ground: string;
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const [pointed, setPointed] = useState<string | null>(null);
  const toggle = (key: string) =>
    setFolded((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const sorted = boxes.toSorted((a, b) => a.top - b.top);
  const tops = labelTops(sorted, editorHeight);
  const placed = sorted.map((box, i) => ({ ...box, labelOffset: tops[i]! - box.top }));
  return (
    <div className={classes.marks} style={{ '--wash-ground': ground } as CSSProperties}>
      {placed.flatMap(({ mark, panes }) =>
        panes.map((pane) => (
          <div
            key={`${mark.key}-${String(pane.left)}`}
            className={classes.wash}
            data-fade={mark.fade}
            data-tone={mark.tone}
            data-pointed={pointed === mark.key || undefined}
            style={{ top: pane.top, left: pane.left, width: pane.width, height: pane.height }}
          />
        )),
      )}
      {placed.map(({ mark, top, height, labelOffset }) => {
        const isFolded = folded.has(mark.key);
        const point = () => setPointed(mark.key);
        const unpoint = () => setPointed((current) => (current === mark.key ? null : current));
        return (
          <div
            key={mark.key}
            className={classes.mark}
            data-tone={mark.tone}
            style={{ top, height }}
          >
            <span
              className={classes.markLabel}
              data-folded={isFolded || undefined}
              data-tone={mark.tone}
              style={{ top: labelOffset }}
              title={isFolded ? `${mark.label}. ${mark.detail}` : mark.detail}
              onPointerEnter={point}
              onPointerLeave={unpoint}
              onFocus={point}
              onBlur={unpoint}
            >
              {!isFolded && (
                <span className={classes.markText}>
                  {mark.parts.map((part, i) =>
                    part.path ? (
                      <span key={i} className={classes.markPath}>
                        <bdi>{part.text}</bdi>
                      </span>
                    ) : (
                      <span key={i} className={classes.markWords}>
                        {part.text}
                      </span>
                    ),
                  )}
                </span>
              )}
              <UnstyledButton
                className={classes.markFold}
                aria-label={isFolded ? `Show label: ${mark.label}` : `Hide label: ${mark.label}`}
                onClick={() => toggle(mark.key)}
              >
                {isFolded ? <IconChevronLeft size={12} /> : <IconChevronRight size={12} />}
              </UnstyledButton>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A label's own height: `.markLabel`'s line height and border. */
const LABEL_BOX = 18;

/** A label's height and the gap under it. */
const LABEL_HEIGHT = LABEL_BOX + 2;

function SnippetEditor({
  chunkFilename,
  language,
  snippet,
  expanded,
  emptySide,
  view,
  wrap,
  skimMarks,
  hunkDebug,
}: {
  chunkFilename: string;
  language: string;
  snippet: InlineDiffSnippet;
  expanded: boolean;
  emptySide: Side | null;
  view: DiffView;
  wrap: DiffWrap;
  skimMarks: SkimMarks;
  hunkDebug: HunkDebug;
}) {
  const theme = useEditorTheme();
  const [editorHeight, setEditorHeight] = useState(MIN_EDITOR_HEIGHT);
  const [boxes, setBoxes] = useState<MarkBox[]>([]);
  const [ground, setGround] = useState('');
  const [cut, setCut] = useState<Cut>(NO_CUT);
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const disposables = useRef<IDisposable[]>([]);
  const host = useRef<HTMLDivElement | null>(null);
  const marks = useMemo(() => {
    if (hunkDebug === 'off') return skimMarks === 'marked' ? hunkMarks(snippet.hunks) : [];
    const debug = debugMarks(snippet.hunks);
    // The debug labels the hunks; it fades them only as skim marks would.
    return skimMarks === 'marked'
      ? debug
      : debug.map((mark) => ({ ...mark, fade: 'none' as const }));
  }, [hunkDebug, skimMarks, snippet.hunks]);
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
  const emptySideRef = useRef(emptySide);
  emptySideRef.current = emptySide;

  const measureMarks = useCallback(() => {
    const diffEditor = editorRef.current;
    if (!diffEditor || !host.current) return;
    const blank = blankRow(diffEditor, emptySideRef.current);
    const next = clipBoxes(
      markBoxes(diffEditor, host.current, snippetRef.current, marksRef.current, viewRef.current),
      blank,
      diffEditor.getModifiedEditor().getContentHeight() - blank.top - blank.bottom,
    );
    setBoxes((previous) => (boxesKey(previous) === boxesKey(next) ? previous : next));
    if (next.length === 0) return;
    // Monaco defines its colours on its own elements, and the overlay is
    // their sibling, so the background the wash fades toward is read off the
    // editor rather than inherited.
    setGround(
      getComputedStyle(diffEditor.getModifiedEditor().getContainerDomNode()).getPropertyValue(
        '--vscode-editor-background',
      ),
    );
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
        const blank = blankRow(diffEditor, emptySideRef.current);
        setCut((previous) =>
          previous.top === blank.top && previous.bottom === blank.bottom ? previous : blank,
        );
        setEditorHeight(
          Math.max(
            contentHeight + EDITOR_HEIGHT_PADDING - blank.top - blank.bottom,
            MIN_EDITOR_HEIGHT,
          ),
        );
        measureMarks();
      };
      disposables.current = [
        original.onDidContentSizeChange(measure),
        modified.onDidContentSizeChange(measure),
        diffEditor.onDidUpdateDiff(measure),
        modified.onDidLayoutChange(measureMarks),
        followSelectionInWindow(original),
        followSelectionInWindow(modified),
      ];
      applyWordWrap(diffEditor, wrapRef.current);
      applySnippetLayout(diffEditor, snippet, expanded, emptySide);
      measure();
    },
    // The mount-time snippet/expanded/emptySide are right for the first paint; later
    // changes are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // `view` belongs here for the relayout, not for the line numbers — see
  // `applySnippetLayout`.
  useEffect(() => {
    if (editorRef.current) applySnippetLayout(editorRef.current, snippet, expanded, emptySide);
  }, [snippet, expanded, emptySide, view]);

  // A flip of the view or the marks moves the lines after this render; the
  // editors have laid out again by the next frame.
  useEffect(() => {
    measureMarks();
    const frame = requestAnimationFrame(measureMarks);
    return () => cancelAnimationFrame(frame);
  }, [measureMarks, marks, view, wrap, expanded, theme]);

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
      ref={host}
      className={classes.editor}
      data-empty-side={emptySide ?? undefined}
      style={{ height: editorHeight }}
      onClick={onClick}
      onPointerDown={keepScroll.onPointerDown}
      onFocus={keepScroll.onFocus}
    >
      {/* Taller than the host by the cut and lifted by its top, so the host's clip takes both rows off. */}
      <div style={{ marginTop: -cut.top, height: editorHeight + cut.top + cut.bottom }}>
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
      </div>
      {boxes.length > 0 && (
        <MarkOverlay boxes={boxes} editorHeight={editorHeight} ground={ground} />
      )}
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
    // The rule under them spans the card, as the header's does; only the text keeps the measure.
    <Box style={{ borderBottom: `1px solid ${token('border')}` }}>
      <Box px={12} py={12} maw="var(--er-measure)" style={{ display: 'grid', rowGap: 16 }}>
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

/**
 * A code card's path, stuck under the topbar, then the facts the card adds
 * about its file, then its actions.
 *
 * The path keeps its file name whole and gives up the start of its directory
 * first, behind an ellipsis, with the whole path in its hover: the leading
 * directories are what a long path shares with its neighbours, and a path
 * that wraps makes a header the code scrolls under twice as tall.
 *
 * `foldable` is for a header whose facts can outgrow one line. Its chevron
 * flips the reader's file-headers preference, which every card follows: one
 * line, the facts clipped where they meet the actions, or every fact on lines
 * of its own below the path.
 */
export function CodeCardHeader({
  filename,
  badge,
  facts,
  actions,
  foldable = false,
}: {
  filename: string;
  /** Before the path: what the file as a whole is, which every fact after it is about. */
  badge?: ReactNode;
  facts?: ReactNode;
  actions?: ReactNode;
  foldable?: boolean;
}) {
  const { dirname, basename } = splitFilename(filename);
  const headers = useFileHeaders((s) => s.headers);
  const toggleHeaders = useFileHeaders((s) => s.toggle);
  const oneLine = !foldable || headers === 'one-line';
  return (
    <div
      className={classes.header}
      data-one-line={oneLine || undefined}
      style={{ position: 'sticky', top: TOPBAR_HEIGHT }}
    >
      <span className={classes.path} title={filename}>
        {badge}
        {dirname.length > 0 && (
          <span className={classes.dirname}>
            <bdi>{dirname}/</bdi>
          </span>
        )}
        <span className={classes.basename}>{basename}</span>
      </span>
      {facts && <span className={classes.facts}>{facts}</span>}
      <span className={classes.actions}>
        {actions}
        {foldable && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-pressed={oneLine}
            aria-label="File headers on one line"
            title={oneLine ? 'Show every fact in file headers' : 'Keep file headers to one line'}
            onClick={toggleHeaders}
          >
            {oneLine ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </ActionIcon>
        )}
      </span>
    </div>
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
  const hunkDebug = useHunkDebug((s) => s.debug);
  const spaceLimited = useReaderColumn(selectSpaceLimited);
  const [expanded, setExpanded] = useState(false);
  const state = useMemo(() => resolveFileState(pair, chunk.filename), [pair, chunk.filename]);
  const emptySide = state.kind === 'ok' ? state.data.emptySide : null;
  /*
   * Too narrow for two panes is not a preference the column can honour, and a
   * file with nothing on one side would spend half its card on that side's
   * hatching. Decided by the sides rather than the status, so a copy shown
   * against its origin keeps both panes.
   */
  const view: DiffView = spaceLimited || emptySide ? 'unified' : stored;

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
  const tags = useMemo(() => factTags(chunk.hunks, chunk.filename), [chunk.hunks, chunk.filename]);

  return (
    <CodeCard label={`Diff for ${chunk.filename}`} diffFile={chunk.filename}>
      <CodeCardHeader
        filename={chunk.filename}
        badge={
          emptySide && (
            <span className={classes.badge} data-empty-side={emptySide}>
              {emptySide === 'original' ? 'New' : 'Deleted'}
            </span>
          )
        }
        foldable={file?.origin !== undefined || tags.length > 0}
        facts={
          (file?.origin || emptySide || tags.length > 0) && (
            <>
              {file?.origin && (
                <Text component="span" fz="xs" c="dimmed" className={classes.fact}>
                  {originVerb(file).toLowerCase()}{' '}
                  <Text component="span" ff="monospace" fz="inherit">
                    {file.origin.filename}
                  </Text>
                </Text>
              )}
              {tags.map((tag) => (
                <Text
                  key={tag.label}
                  {...(tag.opens === null
                    ? { component: 'span' }
                    : {
                        component: 'a',
                        href: fileHref(tag.opens),
                        'aria-label': `${tag.label} · ${tag.lines}, opens ${tag.opens}`,
                      })}
                  fz="xs"
                  c="dimmed"
                  px={6}
                  py={1}
                  title={tag.detail}
                  className={
                    tag.opens === null ? classes.fact : `${classes.fact} ${classes.moveTag}`
                  }
                  style={{
                    borderRadius: 4,
                    border: `1px solid ${token('border')}`,
                    // A move's tag is edged in the colour its region is drawn in.
                    borderLeft: `3px solid ${token(tag.tone === 'move' ? 'before' : 'border')}`,
                  }}
                >
                  {tag.label} · {tag.lines}
                </Text>
              ))}
            </>
          )
        }
        actions={
          state.kind === 'ok' && (
            <UnstyledButton
              px={8}
              py={2}
              fz="sm"
              c="dimmed"
              style={{ borderRadius: 4 }}
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded ? 'Show changes only' : 'Show full file'}
            </UnstyledButton>
          )
        }
      />

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
              emptySide={emptySide}
              view={view}
              wrap={wrap}
              skimMarks={skimMarks}
              hunkDebug={hunkDebug}
            />
          </Box>
        ))}
    </CodeCard>
  );
}
