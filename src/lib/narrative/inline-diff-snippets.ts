import type { ResolvedDiffHunk } from '@enhanced-review/review-types';

/**
 * Pure logic for slicing a base/head file pair down to the lines around
 * each diff hunk. Ported verbatim from `diffy/src/renderer/screens/
 * narrative-review/inline-diff-snippets.ts`. Lives outside the component
 * so the Monaco-free unit tests can cover the maths.
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
  const lines = text.split('\n');
  return lines.slice(startLine - 1, endLine).join('\n');
}

function getSpanEndLine(startLine: number, lineCount: number): number {
  if (lineCount <= 0) {
    return startLine;
  }
  return startLine + lineCount - 1;
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

  return {
    startLine: clampedStart,
    endLine: clampedEnd,
  };
}

export function groupSelectedHunks(hunks: readonly ResolvedDiffHunk[]): ResolvedDiffHunk[][] {
  const sortedHunks = [...hunks].sort((a, b) => a.fileOrder - b.fileOrder);
  const groups: ResolvedDiffHunk[][] = [];

  for (const hunk of sortedHunks) {
    if (groups.length === 0) {
      groups.push([hunk]);
      continue;
    }

    const currentGroup = groups[groups.length - 1];
    const previousHunk = currentGroup[currentGroup.length - 1];
    if (hunk.fileOrder === previousHunk.fileOrder + 1) {
      currentGroup.push(hunk);
      continue;
    }

    groups.push([hunk]);
  }

  return groups;
}

export function formatSelectedHunkLabel(hunks: readonly ResolvedDiffHunk[]): string {
  return [...hunks]
    .sort((a, b) => a.fileOrder - b.fileOrder)
    .map((hunk) => {
      const modifiedEnd = getSpanEndLine(hunk.modified.startLine, hunk.modified.lineCount);
      if (hunk.modified.lineCount > 0) {
        return hunk.modified.lineCount === 1
          ? `L${String(hunk.modified.startLine)}`
          : `L${String(hunk.modified.startLine)}-${String(modifiedEnd)}`;
      }

      const originalEnd = getSpanEndLine(hunk.original.startLine, hunk.original.lineCount);
      return hunk.original.lineCount === 1
        ? `orig L${String(hunk.original.startLine)}`
        : `orig L${String(hunk.original.startLine)}-${String(originalEnd)}`;
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
  return groupSelectedHunks(hunks)
    .map((group) => {
      const firstHunk = group[0];
      const lastHunk = group[group.length - 1];

      const originalBounds = buildSliceBounds(
        firstHunk.original.startLine,
        getSpanEndLine(lastHunk.original.startLine, lastHunk.original.lineCount),
        contextLines,
        originalLineCount,
      );
      const modifiedBounds = buildSliceBounds(
        firstHunk.modified.startLine,
        getSpanEndLine(lastHunk.modified.startLine, lastHunk.modified.lineCount),
        contextLines,
        modifiedLineCount,
      );

      const originalStartLine = originalBounds?.startLine ?? 1;
      const modifiedStartLine = modifiedBounds?.startLine ?? 1;
      const originalSnippet = originalBounds
        ? extractLines(original, originalBounds.startLine, originalBounds.endLine)
        : '';
      const modifiedSnippet = modifiedBounds
        ? extractLines(modified, modifiedBounds.startLine, modifiedBounds.endLine)
        : '';

      if (originalSnippet === '' && modifiedSnippet === '') {
        return null;
      }

      return {
        key: `group-${String(firstHunk.fileOrder)}-${String(lastHunk.fileOrder)}`,
        original: originalSnippet,
        modified: modifiedSnippet,
        originalStartLine,
        modifiedStartLine,
      };
    })
    .filter((snippet): snippet is InlineDiffSnippet => snippet !== null);
}
