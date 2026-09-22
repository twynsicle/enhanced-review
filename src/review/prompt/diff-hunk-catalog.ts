import type { DiffLineSpan } from '../narrative.ts';

/**
 * Numbers every hunk in a unified diff (`H0001`, `H0002`, …) so the prompt
 * can list them and the model can reference them by id instead of quoting
 * code. `parseNarrativeReview` resolves the ids back to line spans.
 */
export interface DiffHunk {
  id: string;
  filename: string;
  header: string;
  /** 1-based position of the hunk within its file. */
  fileOrder: number;
  original: DiffLineSpan;
  modified: DiffLineSpan;
}

export interface DiffHunkIndex {
  hunks: DiffHunk[];
  byId: Partial<Record<string, DiffHunk>>;
}

/**
 * What a model's answer is checked against. The two halves are deliberately
 * not the same list: an id resolves only when the prompt actually showed that
 * hunk, so an id guessed at from a trimmed gap cannot come back as a real line
 * span, while a diagram may name any file in the change, because the file list
 * it takes a name from is never trimmed.
 */
export interface PromptGrounding {
  /** The hunks the prompt listed, by id. */
  shown: DiffHunkIndex;
  /** The paths the review covers. */
  filenames: ReadonlySet<string>;
}

/**
 * Grounding over the hunks a prompt showed. `filenames` defaults to the files
 * those hunks belong to, which is the whole change wherever nothing was
 * trimmed away.
 */
export function groundingFor(
  shown: readonly DiffHunk[],
  filenames?: Iterable<string>,
): PromptGrounding {
  const byId: Partial<Record<string, DiffHunk>> = {};
  for (const hunk of shown) byId[hunk.id] = hunk;
  return {
    shown: { hunks: [...shown], byId },
    filenames: new Set(filenames ?? shown.map((hunk) => hunk.filename)),
  };
}

const DIFF_FILE_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * One side of a hunk header, as a span.
 *
 * A zero-length side is a position, not a range: git writes it as the line the
 * change sits *after*, so `@@ -0,0` inserts above the file's first line and
 * `@@ -1,0` below it. Those are different places, and only a floor of 0 keeps
 * them apart — clamping both to 1 makes the leading context of a diff that
 * starts at line 1 one line longer on the original side than on the modified
 * one, which Monaco re-diffs into a deletion no hunk contains. A side that
 * covers lines is 1-based as usual.
 */
function toLineSpan(startRaw: string, lengthRaw?: string): DiffLineSpan {
  const parsedLength = lengthRaw === undefined ? 1 : Number.parseInt(lengthRaw, 10);
  const lineCount = Number.isFinite(parsedLength) ? Math.max(0, parsedLength) : 1;
  const floor = lineCount === 0 ? 0 : 1;
  const parsedStart = Number.parseInt(startRaw, 10);
  const startLine = Math.max(floor, Number.isFinite(parsedStart) ? parsedStart : floor);
  return { startLine, lineCount };
}

export function buildDiffHunkIndex(diff: string): DiffHunkIndex {
  const hunks: DiffHunk[] = [];
  const byId: Partial<Record<string, DiffHunk>> = {};
  const fileHunkOrder = new Map<string, number>();
  let currentFilename: string | null = null;
  let counter = 0;

  for (const line of diff.split('\n')) {
    const fileMatch = DIFF_FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      currentFilename = fileMatch[2] ?? null;
      continue;
    }
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (!hunkMatch || currentFilename === null) continue;

    counter += 1;
    const fileOrder = (fileHunkOrder.get(currentFilename) ?? 0) + 1;
    fileHunkOrder.set(currentFilename, fileOrder);
    const hunk: DiffHunk = {
      id: `H${String(counter).padStart(4, '0')}`,
      filename: currentFilename,
      header: line,
      fileOrder,
      original: toLineSpan(hunkMatch[1] ?? '1', hunkMatch[2]),
      modified: toLineSpan(hunkMatch[3] ?? '1', hunkMatch[4]),
    };
    hunks.push(hunk);
    byId[hunk.id] = hunk;
  }

  return { hunks, byId };
}
