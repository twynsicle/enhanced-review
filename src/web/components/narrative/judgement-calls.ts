import { judgementCallOwner } from '@/domain/review/coverage';
import type { JudgementCall, NarrativeReview } from '@/domain/review/narrative';

/**
 * Where each of a review's judgement calls gets drawn. Pure, no rendering:
 * the summary lists them and a chapter draws them, and both have to agree on
 * which chapter owns which, or a link in the summary leads somewhere the
 * question is not.
 */
export interface AnchoredJudgementCall {
  call: JudgementCall;
  /** The chapter that draws it. */
  chapterId: string;
}

/**
 * Each judgement call paired with the one chapter that draws it: the first
 * whose card for its file shows one of its hunks.
 *
 * A file two chapters both cite has a diff card in each, and a question drawn
 * on both is the same question asked twice. First wins because that is where
 * the reader meets those lines earliest, so the question arrives with them
 * rather than after.
 *
 * A call no chapter shows the lines for is left out. The parser drops those
 * before they are ever stored, so this is not a second policy — there is
 * simply no card here for one to sit on, and inventing a home for it is how
 * a question ends up somewhere it reads as an interruption.
 */
export function anchorJudgementCalls(review: NarrativeReview): AnchoredJudgementCall[] {
  return (review.judgementCalls ?? []).flatMap((call) => {
    const owner = judgementCallOwner(call, review.chapters);
    return owner ? [{ call, chapterId: owner.id }] : [];
  });
}

/** One chapter's judgement calls, keyed by the file each sits on. */
export function judgementCallsByFile(
  anchored: readonly AnchoredJudgementCall[],
  chapterId: string,
): Map<string, JudgementCall[]> {
  const byFile = new Map<string, JudgementCall[]>();
  for (const anchor of anchored) {
    if (anchor.chapterId !== chapterId) continue;
    const existing = byFile.get(anchor.call.filename);
    if (existing) existing.push(anchor.call);
    else byFile.set(anchor.call.filename, [anchor.call]);
  }
  return byFile;
}
