import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';

/**
 * The few characters that tell one report from another when its title is cut
 * off. A branch has none: its name is often as long as the title and, cut to
 * fit beside it, outweighed the title it was there to support.
 */
export interface ChangeTag {
  text: string;
  kind: 'number' | 'staged';
}

export interface ChangeLabel {
  tag: ChangeTag | null;
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

function changeTag(meta: ReviewMeta): ChangeTag | null {
  if (meta.prNumber !== null) return { text: `#${String(meta.prNumber)}`, kind: 'number' };
  if (meta.kind === 'staged') return { text: 'staged', kind: 'staged' };
  return null;
}

/** The page's `<title>`, led by a PR number when there is one. */
export function documentTitle(review: NarrativeReview, meta: ReviewMeta): string {
  const { tag, title } = changeLabel(review, meta);
  const lead = tag?.kind === 'number' ? `${tag.text} · ` : '';
  return `${lead}${title} · enhanced-review`;
}
