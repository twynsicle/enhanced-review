import type { ResolvedDiffHunk } from './narrative.ts';

/**
 * Pure logic for slicing a base/head file pair down to the lines around each
 * selected diff hunk. Runs in the browser (the inline diff chunk component)
 * and is Monaco-free so the maths can be unit tested.
 */
export interface InlineDiffSnippet {
  key: string;
  original: string;
  modified: string;
  originalStartLine: number;
  modifiedStartLine: number;
}

interface BuildInlineDiffSnippetsParams {
  hunks: readonly ResolvedDiffHunk[];
  original: string;
  modified: string;
  originalLineCount?: number;
  modifiedLineCount?: number;
  contextLines?: number;
}

function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

function extractLines(text: string, startLine: number, endLine: number): string {
  return text
    .split('\n')
    .slice(startLine - 1, endLine)
    .join('\n');
}

function getSpanEndLine(startLine: number, lineCount: number): number {
  if (lineCount <= 0) return startLine;
  return startLine + lineCount - 1;
}

/**
 * The span's first changed line. A zero-length span has none: git writes its
 * start as the line *before* the gap, so `@@ -7,0 +8,2 @@` inserts after
 * original line 7 and the leading context must end at 7, not at 6. Count from
 * the raw start and this side of the snippet opens one line earlier than the
 * other; Monaco re-diffs the two slices it is handed, so it renders the
 * surplus line as a change no hunk contains — a deletion above every
 * insertion-only hunk, an insertion above every deletion-only one.
 *
 * `getSpanEndLine` wants no such correction: 7 really is the last line before
 * the gap, and the trailing context picks up after it either way.
 */
function getSpanStartLine(startLine: number, lineCount: number): number {
  if (lineCount <= 0) return startLine + 1;
  return startLine;
}

function buildSliceBounds(
  startLine: number,
  endLine: number,
  contextLines: number,
  maxLine: number,
): { startLine: number; endLine: number } | null {
  if (maxLine <= 0) return null;

  const unclampedStart = Math.max(1, startLine - contextLines);
  const unclampedEnd = Math.max(unclampedStart, endLine + contextLines);
  const clampedStart = Math.min(unclampedStart, maxLine);
  const clampedEnd = Math.max(clampedStart, Math.min(unclampedEnd, maxLine));

  return { startLine: clampedStart, endLine: clampedEnd };
}

/** Consecutive hunks (by `fileOrder`) form one group; a gap starts a new one. */
export function groupSelectedHunks(hunks: readonly ResolvedDiffHunk[]): ResolvedDiffHunk[][] {
  const sorted = hunks.toSorted((a, b) => a.fileOrder - b.fileOrder);
  const groups: ResolvedDiffHunk[][] = [];

  for (const hunk of sorted) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (current && previous && hunk.fileOrder === previous.fileOrder + 1) {
      current.push(hunk);
    } else {
      groups.push([hunk]);
    }
  }

  return groups;
}

/** "L8-10, orig L20-21": modified ranges, falling back to original for pure deletions. */
export function formatSelectedHunkLabel(hunks: readonly ResolvedDiffHunk[]): string {
  return hunks
    .toSorted((a, b) => a.fileOrder - b.fileOrder)
    .map((hunk) => {
      if (hunk.modified.lineCount > 0) {
        const end = getSpanEndLine(hunk.modified.startLine, hunk.modified.lineCount);
        return hunk.modified.lineCount === 1
          ? `L${String(hunk.modified.startLine)}`
          : `L${String(hunk.modified.startLine)}-${String(end)}`;
      }
      const end = getSpanEndLine(hunk.original.startLine, hunk.original.lineCount);
      return hunk.original.lineCount === 1
        ? `orig L${String(hunk.original.startLine)}`
        : `orig L${String(hunk.original.startLine)}-${String(end)}`;
    })
    .join(', ');
}

export function buildInlineDiffSnippets({
  hunks,
  original,
  modified,
  originalLineCount = countLines(original),
  modifiedLineCount = countLines(modified),
  contextLines = 5,
}: BuildInlineDiffSnippetsParams): InlineDiffSnippet[] {
  const snippets: InlineDiffSnippet[] = [];

  for (const group of groupSelectedHunks(hunks)) {
    const firstHunk = group[0];
    const lastHunk = group.at(-1);
    if (!firstHunk || !lastHunk) continue;

    const originalBounds = buildSliceBounds(
      getSpanStartLine(firstHunk.original.startLine, firstHunk.original.lineCount),
      getSpanEndLine(lastHunk.original.startLine, lastHunk.original.lineCount),
      contextLines,
      originalLineCount,
    );
    const modifiedBounds = buildSliceBounds(
      getSpanStartLine(firstHunk.modified.startLine, firstHunk.modified.lineCount),
      getSpanEndLine(lastHunk.modified.startLine, lastHunk.modified.lineCount),
      contextLines,
      modifiedLineCount,
    );

    const originalSnippet = originalBounds
      ? extractLines(original, originalBounds.startLine, originalBounds.endLine)
      : '';
    const modifiedSnippet = modifiedBounds
      ? extractLines(modified, modifiedBounds.startLine, modifiedBounds.endLine)
      : '';

    if (originalSnippet === '' && modifiedSnippet === '') continue;

    snippets.push({
      key: `group-${String(firstHunk.fileOrder)}-${String(lastHunk.fileOrder)}`,
      original: originalSnippet,
      modified: modifiedSnippet,
      originalStartLine: originalBounds?.startLine ?? 1,
      modifiedStartLine: modifiedBounds?.startLine ?? 1,
    });
  }

  return snippets;
}
