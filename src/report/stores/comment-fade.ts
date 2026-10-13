import { createFadePreference } from '@/report/stores/fade';

/**
 * How far dimmed comments fade, as the share of their strength taken away.
 * Whether to dim them at all is `dim-comments.ts`. Allowed further than a skim
 * hunk's fade: a comment the reader has pushed back may all but vanish, since
 * every line keeps its place and the code around it is untouched.
 *
 * Persisted raw under `er-comment-fade`, painted as `--review-comment-fade`.
 */
export const COMMENT_FADE_KEY = 'er-comment-fade';

export const COMMENT_FADES = { min: 20, max: 90, step: 5, default: 60 } as const;

export const { useFade: useCommentFade, follow: followCommentFade } = createFadePreference({
  key: COMMENT_FADE_KEY,
  variable: '--review-comment-fade',
  range: COMMENT_FADES,
});
