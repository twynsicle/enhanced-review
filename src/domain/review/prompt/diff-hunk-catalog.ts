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

const DIFF_FILE_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function toLineSpan(startRaw: string, lengthRaw?: string): DiffLineSpan {
  const parsedStart = Number.parseInt(startRaw, 10);
  const parsedLength = lengthRaw === undefined ? 1 : Number.parseInt(lengthRaw, 10);
  const startLine = Math.max(1, Number.isFinite(parsedStart) ? parsedStart : 1);
  const lineCount = Number.isFinite(parsedLength) ? Math.max(0, parsedLength) : 1;
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
