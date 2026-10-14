import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';

/** The change's title, as the header, the tab and the summary all name it. */
export function changeTitle(review: NarrativeReview, meta: ReviewMeta): string {
  return review.prTitle || meta.title;
}

/**
 * The few characters that tell one report from another when its title is cut
 * off: the PR's number, or else the branch, which for a branch with no PR is
 * the only name the engineer gave it — its title is the model's.
 */
export function changeTag(meta: ReviewMeta): string | null {
  if (meta.prNumber !== null) return `#${String(meta.prNumber)}`;
  if (meta.kind === 'staged') return 'staged';
  return meta.headRefName;
}

/**
 * The page's `<title>`. Only a PR number leads it: a branch name is often as
 * long as the title, and would push the title out of a crowded tab altogether.
 */
export function documentTitle(review: NarrativeReview, meta: ReviewMeta): string {
  const title = changeTitle(review, meta);
  const lead = meta.prNumber === null ? '' : `#${String(meta.prNumber)} · `;
  return `${lead}${title} · enhanced-review`;
}
