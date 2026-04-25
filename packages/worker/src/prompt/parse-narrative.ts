import type {
  Insight,
  NarrativeReview,
  ResolvedDiffHunk,
} from '@enhanced-review/review-types';

import type { DiffHunkIndex } from './diff-hunk-catalog';

/**
 * Pull a `NarrativeReview` out of opencode's free-form output. The model
 * is instructed to wrap its JSON in `<narrative_review>` tags; the parser
 * locates those, JSON-parses the inner blob, normalises optional fields,
 * and resolves each chunk's hunk IDs back to line spans via the
 * `DiffHunkIndex` produced at prompt-build time.
 *
 * Ported from diffy POC's `parseNarrativeReview`. Kept tolerant of:
 *   - missing chapter ids/titles (synthesised)
 *   - legacy `summary` string in place of `insights[]`
 *   - chunks with unknown / mismatched hunk IDs (silently dropped)
 */

export type ParseResult =
  | { ok: true; data: NarrativeReview }
  | { ok: false; error: string };

function extractHunksFromHunkIds(
  chunk: Record<string, unknown>,
  hunkIndex: DiffHunkIndex | undefined,
): ResolvedDiffHunk[] {
  if (!hunkIndex) return [];
  if (!Array.isArray(chunk['hunkIds'])) return [];

  const filename = typeof chunk['filename'] === 'string' ? chunk['filename'] : '';
  const hunkIds = (chunk['hunkIds'] as unknown[]).filter(
    (id): id is string => typeof id === 'string',
  );
  const dedupedHunks = new Map<string, ResolvedDiffHunk>();

  for (const hunkId of hunkIds) {
    const hunk = hunkIndex.byId[hunkId];
    if (!hunk) continue;
    if (hunk.filename !== filename) continue;
    dedupedHunks.set(hunk.id, {
      id: hunk.id,
      fileOrder: hunk.fileOrder,
      original: { ...hunk.original },
      modified: { ...hunk.modified },
    });
  }

  return [...dedupedHunks.values()].sort((a, b) => a.fileOrder - b.fileOrder);
}

export function parseNarrativeReview(
  text: string,
  hunkIndex?: DiffHunkIndex,
): ParseResult {
  const startTag = '<narrative_review>';
  const endTag = '</narrative_review>';
  const startIdx = text.indexOf(startTag);
  const endIdx = text.indexOf(endTag);

  if (startIdx === -1 || endIdx === -1) {
    return { ok: false, error: 'Response did not contain expected <narrative_review> tags' };
  }

  const jsonStr = text.slice(startIdx + startTag.length, endIdx).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { ok: false, error: 'Failed to parse narrative review JSON from response' };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as NarrativeReview).prTitle !== 'string' ||
    typeof (parsed as NarrativeReview).overviewSummary !== 'string' ||
    !Array.isArray((parsed as NarrativeReview).chapters)
  ) {
    return { ok: false, error: 'Narrative review JSON is missing required fields' };
  }

  type RawChapter = Record<string, unknown> & { summary?: string };
  const rawChapters = (parsed as { chapters: RawChapter[] }).chapters;

  for (let i = 0; i < rawChapters.length; i++) {
    const ch = rawChapters[i]!;

    if (typeof ch['id'] !== 'string' || (ch['id'] as string).length === 0) {
      ch['id'] = `chapter-${String(i + 1)}`;
    }
    if (typeof ch['title'] !== 'string' || (ch['title'] as string).length === 0) {
      ch['title'] = `Chapter ${String(i + 1)}`;
    }

    if (!Array.isArray(ch['insights']) && typeof ch.summary === 'string') {
      ch['insights'] = [{ type: 'context', text: ch.summary } satisfies Insight];
      delete ch.summary;
    }

    if (!Array.isArray(ch['insights'])) {
      ch['insights'] = [];
    }
    ch['insights'] = (ch['insights'] as unknown[]).filter(
      (ins) =>
        typeof ins === 'object' &&
        ins !== null &&
        typeof (ins as Record<string, unknown>)['type'] === 'string' &&
        typeof (ins as Record<string, unknown>)['text'] === 'string',
    );

    if (!Array.isArray(ch['diffChunks'])) {
      ch['diffChunks'] = [];
    }
    ch['diffChunks'] = (ch['diffChunks'] as unknown[]).filter(
      (chunk) =>
        typeof chunk === 'object' &&
        chunk !== null &&
        typeof (chunk as Record<string, unknown>)['filename'] === 'string',
    );

    for (const chunk of ch['diffChunks'] as Record<string, unknown>[]) {
      if (typeof chunk['language'] !== 'string') {
        chunk['language'] = 'plaintext';
      }
      chunk['hunks'] = extractHunksFromHunkIds(chunk, hunkIndex);
    }

    ch['diffChunks'] = (ch['diffChunks'] as Record<string, unknown>[]).filter(
      (chunk) => Array.isArray(chunk['hunks']) && (chunk['hunks'] as ResolvedDiffHunk[]).length > 0,
    );
  }

  return { ok: true, data: parsed as NarrativeReview };
}
