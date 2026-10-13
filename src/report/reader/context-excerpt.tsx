import { Box, Skeleton, Text } from '@mantine/core';
import type { editor, IDisposable } from 'monaco-editor';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ContextExcerpt } from '@/review/narrative';
import { useFilePair } from '@/report/reader/file-source';
import { CodeCard, CodeCardHeader } from '@/report/reader/inline-diff-chunk';
import {
  CodeEditor,
  EDITOR_HEIGHT_PADDING,
  lineNumberWidth,
  makeOffsetLineNumbers,
  MIN_EDITOR_HEIGHT,
  useEditorTheme,
  useLayoutOnColumnSettle,
  useScrollKeptOnFocus,
} from '@/report/reader/monaco-editors';
import { useDiffWrap } from '@/report/stores/diff-wrap';
import { token } from '@/report/theme/tokens';
import classes from './context-excerpt.module.css';

export function lineRange({ startLine, endLine }: ContextExcerpt): string {
  return startLine === endLine
    ? `L${String(startLine)}`
    : `L${String(startLine)}–${String(endLine)}`;
}

/**
 * The excerpt's lines in a read-only editor, numbered as the file numbers
 * them. The model holds only those lines and the gutter is offset, as a
 * collapsed diff snippet's is, rather than holding the whole file and hiding
 * the rest: a hidden area still scrolls and still answers a search, and an
 * excerpt is meant to be exactly the lines its reason is about.
 */
function ExcerptEditor({
  modelKey,
  filename,
  text,
  startLine,
  language,
}: {
  modelKey: string;
  filename: string;
  text: string;
  startLine: number;
  language: string;
}) {
  const theme = useEditorTheme();
  const wrap = useDiffWrap((s) => s.wrap);
  const [height, setHeight] = useState(MIN_EDITOR_HEIGHT);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const disposables = useRef<IDisposable[]>([]);
  const keepScroll = useScrollKeptOnFocus();
  useLayoutOnColumnSettle(editorRef);

  const onMount = useCallback((codeEditor: editor.IStandaloneCodeEditor) => {
    editorRef.current = codeEditor;
    const measure = (): void => {
      setHeight(
        Math.max(codeEditor.getContentHeight(), MIN_EDITOR_HEIGHT - EDITOR_HEIGHT_PADDING) +
          EDITOR_HEIGHT_PADDING,
      );
    };
    disposables.current = [codeEditor.onDidContentSizeChange(measure)];
    measure();
  }, []);

  useEffect(
    () => () => {
      for (const disposable of disposables.current) disposable.dispose();
      disposables.current = [];
      editorRef.current = null;
    },
    [],
  );

  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: true,
      domReadOnly: true,
      wordWrap: wrap,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      lineNumbers: makeOffsetLineNumbers(startLine),
      lineNumbersMinChars: lineNumberWidth(startLine, text),
      automaticLayout: true,
      scrollBeyondLastLine: false,
      scrollbar: { vertical: 'hidden', horizontal: 'auto', handleMouseWheel: false },
      folding: false,
      glyphMargin: false,
      lineDecorationsWidth: 6,
      renderLineHighlight: 'none',
    }),
    [wrap, startLine, text],
  );

  const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
  const fallback = <Skeleton height={MIN_EDITOR_HEIGHT} radius={0} />;
  return (
    <div
      className={classes.editor}
      style={{ height }}
      onPointerDown={keepScroll.onPointerDown}
      onFocus={keepScroll.onFocus}
    >
      <Suspense fallback={fallback}>
        <CodeEditor
          value={text}
          language={language}
          path={`file:///__excerpt__/${encodeURIComponent(modelKey)}/${encodedPath}`}
          theme={theme}
          onMount={onMount}
          loading={fallback}
          options={options}
        />
      </Suspense>
    </div>
  );
}

/**
 * Unchanged code the chapter's change reaches without editing it, in the
 * same card as a diff: its path and span, the one sentence saying why it is
 * here, then the lines themselves. The file rides in the bundle with both
 * sides the same, so it is read through `useFilePair` like any changed file
 * while never being listed as one.
 */
export function ContextExcerptCard({
  excerpt,
  modelKey,
}: {
  excerpt: ContextExcerpt;
  /** Unique on the page, so two excerpts of one file never share an editor model. */
  modelKey: string;
}) {
  const { head } = useFilePair(excerpt.filename);
  const text = useMemo(
    () =>
      head.kind === 'content'
        ? head.content
            .split('\n')
            .slice(excerpt.startLine - 1, excerpt.endLine)
            .join('\n')
        : null,
    [head, excerpt.startLine, excerpt.endLine],
  );
  const range = lineRange(excerpt);
  return (
    <CodeCard label={`Unchanged code in ${excerpt.filename}, ${range}`}>
      <CodeCardHeader filename={excerpt.filename}>
        <Text component="span" fz="xs" c="dimmed">
          unchanged · {range}
        </Text>
      </CodeCardHeader>
      <Box
        px={12}
        py={10}
        maw="var(--er-measure)"
        style={{ borderBottom: `1px solid ${token('border')}` }}
      >
        <Text fz="sm">{excerpt.reason}</Text>
      </Box>
      {text === null || head.kind !== 'content' ? (
        <Text px={12} py={16} fz="sm" c="dimmed">
          This file isn&rsquo;t in the report, so these lines can&rsquo;t be shown.
        </Text>
      ) : (
        <ExcerptEditor
          modelKey={modelKey}
          filename={excerpt.filename}
          text={text}
          startLine={excerpt.startLine}
          language={head.language}
        />
      )}
    </CodeCard>
  );
}
