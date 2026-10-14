import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';

/**
 * The few characters that tell one report from another when its title is cut
 * off. A `number` (a PR's) or `staged` is short and kept whole; a branch's
 * `name` can be as long as the title, so it is the one that may give way.
 */
export interface ChangeTag {
  text: string;
  kind: 'number' | 'staged' | 'name';
}

export interface ChangeLabel {
  tag: ChangeTag | null;
  title: string;
}

/** The change's title, as the header, the tab and the summary all name it. */
export function changeTitle(review: NarrativeReview, meta: ReviewMeta): string {
  return review.prTitle || meta.title;
}

/**
 * The tag and the title the header shows. A branch with no PR is tagged by its
 * name, since its title is the model's and the branch is what the engineer
 * called it; a title that falls back to that same name is shown once.
 */
export function changeLabel(review: NarrativeReview, meta: ReviewMeta): ChangeLabel {
  const title = changeTitle(review, meta);
  const tag = changeTag(meta);
  return { tag: tag?.text === title ? null : tag, title };
}

function changeTag(meta: ReviewMeta): ChangeTag | null {
  if (meta.prNumber !== null) return { text: `#${String(meta.prNumber)}`, kind: 'number' };
  if (meta.kind === 'staged') return { text: 'staged', kind: 'staged' };
  return meta.headRefName === null ? null : { text: meta.headRefName, kind: 'name' };
}

/**
 * The page's `<title>`. Only a PR number leads it: a branch name is often as
 * long as the title, and would push the title out of a crowded tab altogether.
 */
export function documentTitle(review: NarrativeReview, meta: ReviewMeta): string {
  const { tag, title } = changeLabel(review, meta);
  const lead = tag?.kind === 'number' ? `${tag.text} · ` : '';
  return `${lead}${title} · enhanced-review`;
}
