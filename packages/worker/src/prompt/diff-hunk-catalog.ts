import type { DiffLineSpan } from '@enhanced-review/review-types';

/**
 * Build a stable index of "hunks" from a unified diff so the model can
 * reference them by short ID. Ported from diffy POC's
 * `diff-hunk-catalog.ts`.
 *
 * The narrative prompt embeds the catalog (H0001…) and asks the model to
 * emit hunk IDs in each diff chunk. The post-process resolver
 * (parse-narrative.ts) maps those IDs back to `ResolvedDiffHunk` line
 * spans so the reader UI can deep-link into the diff.
 */

export interface DiffHunk {
  id: string;
  filename: string;
  header: string;
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
  const lines = diff.split('\n');
  const hunks: DiffHunk[] = [];
  const byId: Partial<Record<string, DiffHunk>> = {};

  let currentFilename: string | null = null;
  let hunkCounter = 0;
  const fileHunkOrder = new Map<string, number>();

  for (const line of lines) {
    const fileMatch = line.match(DIFF_FILE_HEADER_RE);
    if (fileMatch) {
      currentFilename = fileMatch[2] ?? null;
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (!hunkMatch || currentFilename === null) {
      continue;
    }

    hunkCounter += 1;
    const id = `H${String(hunkCounter).padStart(4, '0')}`;
    const fileOrder = (fileHunkOrder.get(currentFilename) ?? 0) + 1;
    fileHunkOrder.set(currentFilename, fileOrder);

    const hunk: DiffHunk = {
      id,
      filename: currentFilename,
      header: line,
      fileOrder,
      original: toLineSpan(hunkMatch[1]!, hunkMatch[2]),
      modified: toLineSpan(hunkMatch[3]!, hunkMatch[4]),
    };
    hunks.push(hunk);
    byId[id] = hunk;
  }

  return { hunks, byId };
}
