import { Box, Text, useComputedColorScheme } from '@mantine/core';
import type * as MonacoReact from '@monaco-editor/react';
import type { DiffEditorProps, EditorProps } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { lazy, useCallback, useEffect, useRef, type ComponentType, type RefObject } from 'react';
import { MONACO_VS_URL } from '@/report/reader/monaco-cdn';
import { defineEditorThemes, editorTheme } from '@/report/reader/monaco-themes';
import { useReaderColumn } from '@/report/stores/diff-view';
import { useDimComments } from '@/report/stores/dim-comments';

/**
 * The code viewer: the one place the reader imports Monaco, and what its two
 * editors share — the diff editor every changed hunk is drawn in, and the
 * plain read-only editor an excerpt of unchanged code is drawn in.
 */

/**
 * Stands in for a diff or an excerpt whose editor never arrived. The reader is
 * told what is missing and what to try, because the alternative — and what
 * this replaced — is a card with a header and an empty body, which reads as a
 * file with no changes in it rather than as a failure.
 *
 * It names no library: "Monaco" is not a word the recipient of a review has
 * any reason to know. Reloading is named in prose rather than offered as a
 * button, matching the report's other failure surface; a control inside a
 * code strip that silently reloads the whole page is a bigger action than it
 * would look.
 */
function CodeViewerUnavailable({ subject }: { subject: 'diff' | 'excerpt' }) {
  return (
    <Box px={12} py={10}>
      <Text fz="sm" c="dimmed">
        The code viewer didn&rsquo;t load, so this {subject} can&rsquo;t be shown. Reloading the
        page may fix it.
      </Text>
    </Box>
  );
}

function DiffUnavailable() {
  return <CodeViewerUnavailable subject="diff" />;
}

function ExcerptUnavailable() {
  return <CodeViewerUnavailable subject="excerpt" />;
}

/**
 * Monaco is loaded lazily, so the report paints before the editor arrives.
 *
 * Pointing the CDN at the declared version happens here, rather than as a
 * side effect of importing `monaco-cdn.ts`, so that the loader ships with the
 * editor instead of riding in the initial bundle — and so that the pin is a
 * call someone can see, not an import that looks unused. Both editors share
 * the one load, so the configuration is in place before either reads it.
 *
 * `init` is awaited here rather than left to the editor because this is the
 * only place its failure can be caught. The library calls it on mount, logs
 * whatever it rejects with and renders nothing further, so the failure
 * reaches no error boundary — a rejected promise is not a throw — and every
 * diff on the page was left an empty box with no explanation. Awaiting it
 * here makes "the editor is unavailable" a question of which component each
 * `lazy` resolves to, which is answerable.
 *
 * One "Uncaught (in promise)" survives in the console and is not ours to
 * catch: `makeCancelable` in `@monaco-editor/loader` calls `.then(onFulfilled)`
 * with no rejection handler beside its `.catch`, so the promise that derives
 * from leaks once per `init`. What did go is the library's own
 * "Monaco initialization: error" — the editor is never mounted now, so it
 * never makes the call that would log it.
 */
let loading: Promise<typeof MonacoReact | null> | undefined;

function loadMonaco(): Promise<typeof MonacoReact | null> {
  loading ??= (async () => {
    const mod = await import('@monaco-editor/react');
    mod.loader.config({ paths: { vs: MONACO_VS_URL } });
    let monaco;
    try {
      monaco = await mod.loader.init();
    } catch {
      return null;
    }
    defineEditorThemes(monaco);
    return mod;
  })();
  return loading;
}

export const DiffEditor = lazy<ComponentType<DiffEditorProps>>(async () => {
  const mod = await loadMonaco();
  return { default: mod ? mod.DiffEditor : DiffUnavailable };
});

export const CodeEditor = lazy<ComponentType<EditorProps>>(async () => {
  const mod = await loadMonaco();
  return { default: mod ? mod.Editor : ExcerptUnavailable };
});

/**
 * The theme both editors are handed. The library passes a changed `theme` to
 * `setTheme` on the live editor, so a flip of the scheme or of the comments
 * restyles in place rather than remounting.
 */
export function useEditorTheme(): string {
  const scheme = useComputedColorScheme('dark');
  const comments = useDimComments((s) => s.comments);
  return editorTheme(scheme, comments);
}

/** An editor's height is its content's plus this, and never under the minimum. */
export const MIN_EDITOR_HEIGHT = 60;
export const EDITOR_HEIGHT_PADDING = 12;

export function makeOffsetLineNumbers(offset: number): editor.LineNumbersType {
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
export function lineNumberWidth(startLine: number, text: string): number {
  const lastLine = startLine + text.split('\n').length - 1;
  return Math.max(3, String(lastLine).length + 1);
}

/**
 * How long the measured column has to hold still before the editors are laid
 * out against it. The width arrives about once an animation frame for as long
 * as the sidebar handle is dragged or the window edge held, and a relayout
 * reflows every line of every editor on the page — so this is the trailing edge
 * of a drag, not a frame of it. Long enough to coalesce a drag, short enough
 * that a reader who lets go does not watch the code catch up.
 */
const COLUMN_SETTLE_MS = 120;

/**
 * The column the reader gives this editor is the one width `automaticLayout`
 * cannot see — its container is sized from the measured content — and nothing
 * else notices it: a window resize that does not cross
 * `SIDE_BY_SIDE_MIN_WIDTH` changes no content, no flag and no preference.
 * Unwrapped that only left a stale horizontal scrollbar; wrapped, the wrap
 * column is stale too, so lines break at a width the pane no longer has and
 * the overflow is clipped rather than scrollable.
 *
 * Subscribed to rather than read as state: the width arrives once a frame for
 * as long as a drag lasts, and a hook would put every editor on the page
 * through a render for each of them.
 */
export function useLayoutOnColumnSettle(editorRef: RefObject<{ layout: () => void } | null>): void {
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
  }, [editorRef]);
}

/** How long a pointerdown's scroll offset stays good for the focus it expects. */
const PENDING_SCROLL_MS = 300;

/**
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
export function useScrollKeptOnFocus(): { onPointerDown: () => void; onFocus: () => void } {
  const pendingScroll = useRef<{ x: number; y: number; at: number } | null>(null);
  const onPointerDown = useCallback(() => {
    pendingScroll.current = { x: window.scrollX, y: window.scrollY, at: performance.now() };
  }, []);
  const onFocus = useCallback(() => {
    const pos = pendingScroll.current;
    pendingScroll.current = null;
    if (pos && performance.now() - pos.at < PENDING_SCROLL_MS) window.scrollTo(pos.x, pos.y);
  }, []);
  return { onPointerDown, onFocus };
}
