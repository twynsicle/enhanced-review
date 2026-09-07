import { z } from 'zod';
import type { ReviewTarget } from '@enhanced-review/github-client';

/**
 * Zod validator for the `ReviewTarget` shape that flows from the picker UI
 * into `POST /api/jobs`. Keep in lockstep with the TS type in the
 * `@enhanced-review/github-client` package.
 *
 * `headSha` / `baseSha` are accepted from the client but the API
 * re-resolves `headSha` against GitHub before insert, so a stale value is
 * harmless.
 */
export const ReviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pr'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    number: z.number().int().positive(),
    headSha: z.string().min(1),
    baseSha: z.string().min(1),
    title: z.string(),
  }),
  z.object({
    kind: z.literal('branch'),
    owner: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1),
    headSha: z.string().min(1),
    baseRef: z.string().min(1),
    baseSha: z.string().min(1),
  }),
]) satisfies z.ZodType<ReviewTarget>;
