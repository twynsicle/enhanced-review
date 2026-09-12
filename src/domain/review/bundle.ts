import { z } from 'zod';
import type { FileAtRef, GithubResult } from '../github/types.ts';
import { detectLanguage } from './language-map.ts';
import { NarrativeReviewSchema } from './narrative.ts';
import { ReviewMetaSchema } from './review-meta.ts';

/**
 * A review packed with everything the reader needs to render it offline: the
 * narrative, the header, and both sides of every file the reader may diff.
 * The local CLI writes one into each `review.html`. Shared by server and
 * browser.
 *
 * Reports are ephemeral, so there is no backward compatibility: bump
 * `BUNDLE_SCHEMA_VERSION` on any breaking change and the reader asks for the
 * review to be regenerated instead of guessing at an old shape.
 */
export const BUNDLE_SCHEMA_VERSION = 1;

/** One side of a file: its content, absent (added or deleted on that side), or too large to embed. */
export const EmbeddedSideSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('content'), content: z.string() }),
  z.object({ kind: z.literal('absent') }),
  z.object({ kind: z.literal('too-large') }),
]);
export type EmbeddedSide = z.infer<typeof EmbeddedSideSchema>;

export const EmbeddedFileSchema = z.object({ base: EmbeddedSideSchema, head: EmbeddedSideSchema });
export type EmbeddedFile = z.infer<typeof EmbeddedFileSchema>;

export const ReviewBundleSchema = z.object({
  schemaVersion: z.literal(BUNDLE_SCHEMA_VERSION),
  generatedAt: z.iso.datetime(),
  meta: ReviewMetaSchema,
  review: NarrativeReviewSchema,
  files: z.record(z.string(), EmbeddedFileSchema),
});
export type ReviewBundle = z.infer<typeof ReviewBundleSchema>;

export type BundleParseResult =
  | { ok: true; bundle: ReviewBundle }
  | { ok: false; reason: 'version-mismatch'; found: unknown }
  | { ok: false; reason: 'invalid'; message: string };

/** Parse an embedded bundle; a different `schemaVersion` is reported on its own, before the shape is checked. */
export function parseBundle(raw: unknown): BundleParseResult {
  const version =
    typeof raw === 'object' && raw !== null && 'schemaVersion' in raw
      ? raw.schemaVersion
      : undefined;
  if (version !== BUNDLE_SCHEMA_VERSION) {
    return { ok: false, reason: 'version-mismatch', found: version };
  }
  const parsed = ReviewBundleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid', message: parsed.error.message };
  return { ok: true, bundle: parsed.data };
}

/** Both sides of one file, in the shape the reader's diff takes from any file source. */
export interface FilePair {
  base: GithubResult<FileAtRef>;
  head: GithubResult<FileAtRef>;
}

function toSide(side: EmbeddedSide | undefined, path: string): GithubResult<FileAtRef> {
  if (!side || side.kind === 'absent') return { ok: false, error: { kind: 'not-found' } };
  if (side.kind === 'too-large') return { ok: false, error: { kind: 'too-large' } };
  const { content } = side;
  return {
    ok: true,
    data: {
      content,
      language: detectLanguage(path),
      lineCount: content === '' ? 0 : content.split('\n').length,
    },
  };
}

/** Look a file up in a bundle; a path it does not hold is missing on both sides. */
export function filePair(bundle: ReviewBundle, path: string): FilePair {
  const file = bundle.files[path];
  return { base: toSide(file?.base, path), head: toSide(file?.head, path) };
}
