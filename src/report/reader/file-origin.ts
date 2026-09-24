import type { ReviewFile, ReviewFileOrigin, ReviewFileStatus } from '@/review/narrative';

/** How a file with an origin is introduced, before the old path. */
export function originVerb(file: ReviewFile): string {
  return file.status === 'copied' ? 'Copied from' : 'Renamed from';
}

/**
 * How much of the old file survives. At 100 a percentage undersells it; and an
 * identical copy is shown as the new file it is, all additions, where
 * "unchanged" beside the count would read as a contradiction.
 */
export function similarityText(origin: ReviewFileOrigin, status: ReviewFileStatus): string {
  if (origin.similarity !== 100) return `${String(origin.similarity)}% similar`;
  return status === 'copied' ? 'identical' : 'content unchanged';
}

/** The origin in one line, for a tooltip; null for a file with none. */
export function originSentence(file: ReviewFile): string | null {
  if (!file.origin) return null;
  return `${originVerb(file)} ${file.origin.filename} (${similarityText(file.origin, file.status)})`;
}
