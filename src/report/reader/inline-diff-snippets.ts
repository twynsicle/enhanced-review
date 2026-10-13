import type { CitedHunk, DiffLineSpan, HunkTier, ResolvedDiffHunk } from '@/review/narrative';

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
  /** The one tier every hunk in the snippet shares. */
  tier: HunkTier;
  /** The cited hunks the snippet draws; none for a whole file. */
  hunks: readonly CitedHunk[];
}

interface BuildInlineDiffSnippetsParams {
  hunks: readonly CitedHunk[];
  original: string;
  modified: string;
  originalLineCount?: number;
  modifiedLineCount?: number;
  contextLines?: number;
  /**
   * Every hunk of the file, cited or not. Context around a group stops short
   * of its neighbours, so a chapter never draws lines another hunk changed as
   * though they were its own — which a split hunk's parts, sitting flush
   * against each other, would otherwise do on every snippet.
   */
  fileHunks?: readonly ResolvedDiffHunk[];
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
  context: { before: number; after: number },
  maxLine: number,
): { startLine: number; endLine: number } | null {
  if (maxLine <= 0) return null;

  const unclampedStart = Math.max(1, startLine - context.before);
  const unclampedEnd = Math.max(unclampedStart, endLine + context.after);
  const clampedStart = Math.min(unclampedStart, maxLine);
  const clampedEnd = Math.max(clampedStart, Math.min(unclampedEnd, maxLine));

  return { startLine: clampedStart, endLine: clampedEnd };
}

/**
 * Unchanged lines between two hunks of one file, `earlier` before `later`.
 * The same count on either side, since nothing between them changed; a side
 * where either hunk has no lines places it after the line it names.
 */
function linesBetween(earlier: DiffLineSpan, later: DiffLineSpan): number {
  const after =
    earlier.lineCount > 0 ? earlier.startLine + earlier.lineCount : earlier.startLine + 1;
  const first = later.lineCount > 0 ? later.startLine : later.startLine + 1;
  return Math.max(0, first - after);
}

/**
 * How much context a group may take before and after it without reaching
 * another hunk. `neighbours` holds the cited hunks as well as the file's, so
 * two flush groups of different tiers stop short of each other even where the
 * file carries no catalog.
 */
function contextFor(
  group: readonly ResolvedDiffHunk[],
  neighbours: readonly ResolvedDiffHunk[],
  contextLines: number,
): { before: number; after: number } {
  const first = group[0]!;
  const last = group.at(-1)!;
  const previous = neighbours.find((hunk) => hunk.fileOrder === first.fileOrder - 1);
  const next = neighbours.find((hunk) => hunk.fileOrder === last.fileOrder + 1);
  const gap = (a: ResolvedDiffHunk, b: ResolvedDiffHunk) =>
    Math.min(linesBetween(a.original, b.original), linesBetween(a.modified, b.modified));
  return {
    before: previous ? Math.min(contextLines, gap(previous, first)) : contextLines,
    after: next ? Math.min(contextLines, gap(last, next)) : contextLines,
  };
}

/**
 * Consecutive hunks (by `fileOrder`) of one tier form one group; a gap or a
 * change of tier starts a new one, since a group is what the reader folds.
 */
export function groupSelectedHunks(hunks: readonly CitedHunk[]): CitedHunk[][] {
  const sorted = hunks.toSorted((a, b) => a.fileOrder - b.fileOrder);
  const groups: CitedHunk[][] = [];

  for (const hunk of sorted) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    if (
      current &&
      previous &&
      hunk.fileOrder === previous.fileOrder + 1 &&
      hunk.tier === previous.tier
    ) {
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
  fileHunks = [],
}: BuildInlineDiffSnippetsParams): InlineDiffSnippet[] {
  const snippets: InlineDiffSnippet[] = [];
  const neighbours = [...fileHunks, ...hunks];

  for (const group of groupSelectedHunks(hunks)) {
    const firstHunk = group[0];
    const lastHunk = group.at(-1);
    if (!firstHunk || !lastHunk) continue;
    const context = contextFor(group, neighbours, contextLines);

    const originalBounds = buildSliceBounds(
      getSpanStartLine(firstHunk.original.startLine, firstHunk.original.lineCount),
      getSpanEndLine(lastHunk.original.startLine, lastHunk.original.lineCount),
      context,
      originalLineCount,
    );
    const modifiedBounds = buildSliceBounds(
      getSpanStartLine(firstHunk.modified.startLine, firstHunk.modified.lineCount),
      getSpanEndLine(lastHunk.modified.startLine, lastHunk.modified.lineCount),
      context,
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
      tier: firstHunk.tier,
      hunks: group,
    });
  }

  return snippets;
}

/**
 * The lines a group's hunks span, the longer side of each: what a reader
 * opening a fold is about to be shown, context lines and all.
 */
export function groupLineCount(hunks: readonly ResolvedDiffHunk[]): number {
  return hunks.reduce(
    (sum, hunk) => sum + Math.max(hunk.original.lineCount, hunk.modified.lineCount),
    0,
  );
}
