import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';

export interface ChangeLabel {
  /**
   * The few characters that tell one report from another when its title is
   * cut off: a PR's number, or `staged`. A branch has none: its name is often
   * as long as the title and, cut to fit beside it, outweighed the title it
   * was there to support.
   */
  tag: string | null;
  title: string;
}

/** The change's title, as the header, the tab and the summary all name it. */
export function changeTitle(review: NarrativeReview, meta: ReviewMeta): string {
  return review.prTitle || meta.title;
}

/** The tag and the title the header shows. */
export function changeLabel(review: NarrativeReview, meta: ReviewMeta): ChangeLabel {
  return { tag: changeTag(meta), title: changeTitle(review, meta) };
}

function changeTag(meta: ReviewMeta): string | null {
  if (meta.prNumber !== null) return prTag(meta.prNumber);
  return meta.kind === 'staged' ? 'staged' : null;
}

function prTag(prNumber: number): string {
  return `#${String(prNumber)}`;
}

/** The page's `<title>`, led by a PR number when there is one. */
export function documentTitle(review: NarrativeReview, meta: ReviewMeta): string {
  const lead = meta.prNumber === null ? '' : `${prTag(meta.prNumber)} · `;
  return `${lead}${changeTitle(review, meta)} · enhanced-review`;
}
