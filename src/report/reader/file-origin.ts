import type { ReviewFile } from '@/review/narrative';

/** How a file with an origin is introduced, before the old path. */
export function originVerb(file: ReviewFile): string {
  return file.status === 'copied' ? 'Copied from' : 'Renamed from';
}

/** How much of the old file survives. At 100 git found the content unchanged, so a percentage undersells it. */
export function similarityText(similarity: number): string {
  return similarity === 100 ? 'content unchanged' : `${String(similarity)}% similar`;
}

/** The origin in one line, for a tooltip; null for a file with none. */
export function originSentence(file: ReviewFile): string | null {
  if (!file.origin) return null;
  return `${originVerb(file)} ${file.origin.filename} (${similarityText(file.origin.similarity)})`;
}
