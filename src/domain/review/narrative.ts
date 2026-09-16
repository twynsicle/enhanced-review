import { z } from 'zod';
import { DiagramSchema } from './diagram.ts';

/**
 * The narrative review shape: what the executor produces, what
 * `reviews.content` stores and what the reader renders. Shared by server and
 * browser, so nothing here may touch Node or the db.
 *
 * Zod is the source of truth; the exported types are inferred from it so the
 * schema that parses `reviews.content` at the db boundary and the type the
 * components consume cannot drift apart. A field is optional here only when a
 * review that has one is genuinely valid without it — never to accommodate
 * something an older version wrote, since nothing here has to read that.
 */

/**
 * A passage of the review's prose: one short sentence, and the detail beneath
 * it when there is any.
 *
 * Two fields rather than one because a single free-text field is what produced
 * the prose this replaced — 50-word sentences carrying four coordinate clauses,
 * four-item lists written out inline, and no structure anywhere. The instruction
 * that governed it budgeted *sentences* ("2-4 sentences"), which caps the wrong
 * unit: the model settles on what it wants to say and then fits it into the
 * allowance, so a tighter budget bought longer sentences rather than less text.
 * A `lede` that must fit one short sentence cannot be crammed, and a `body` that
 * is explicitly Markdown is free to be the list most of that prose wanted to be.
 */
export const ProseSchema = z.object({
  lede: z.string(),
  body: z.string().optional(),
});
export type Prose = z.infer<typeof ProseSchema>;

export const InsightTypeSchema = z.enum(['context', 'rationale', 'highlight', 'reference']);
export type InsightType = z.infer<typeof InsightTypeSchema>;

export const InsightSchema = z.object({
  type: InsightTypeSchema,
  /** Short headline (4–10 words) naming the takeaway. Optional because the model sometimes omits it. */
  title: z.string().optional(),
  text: z.string(),
  /**
   * The file this insight is about, when it is about one in particular.
   *
   * An insight only makes sense where its subject is: a note on why a constant
   * is 14 and not 3 is an interruption above the diff and an answer beside it.
   * So an anchored insight is drawn on that file's diff card instead of in the
   * chapter's list. Only a path the chapter itself cites survives parsing —
   * anchoring to a card that is not on the page would lose the insight
   * altogether, and it is better unanchored than gone.
   */
  filename: z.string().optional(),
});
export type Insight = z.infer<typeof InsightSchema>;

export const DiffLineSpanSchema = z.object({
  startLine: z.number().int(),
  lineCount: z.number().int(),
});
export type DiffLineSpan = z.infer<typeof DiffLineSpanSchema>;

export const ResolvedDiffHunkSchema = z.object({
  id: z.string(),
  fileOrder: z.number().int(),
  original: DiffLineSpanSchema,
  modified: DiffLineSpanSchema,
});
export type ResolvedDiffHunk = z.infer<typeof ResolvedDiffHunkSchema>;

export const DiffChunkSchema = z.object({
  filename: z.string(),
  language: z.string(),
  hunks: z.array(ResolvedDiffHunkSchema),
});
export type DiffChunk = z.infer<typeof DiffChunkSchema>;

export const ReviewFileStatusSchema = z.enum([
  'added',
  'modified',
  'removed',
  'renamed',
  'copied',
  'unchanged',
]);
export type ReviewFileStatus = z.infer<typeof ReviewFileStatusSchema>;

/**
 * Why a changed file was left out of the review: marked `linguist-generated`
 * or `linguist-vendored` in `.gitattributes`, on the built-in list of
 * lockfiles, bundles and snapshots (`prompt/ai-file-filter.ts`), or binary.
 */
export const ReviewFileSkipReasonSchema = z.enum(['generated', 'vendored', 'built-in', 'binary']);
export type ReviewFileSkipReason = z.infer<typeof ReviewFileSkipReasonSchema>;

export const ReviewFileSchema = z.object({
  filename: z.string(),
  status: ReviewFileStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  /** Set when the file changed but was not reviewed. */
  skipped: ReviewFileSkipReasonSchema.optional(),
  /**
   * Every hunk of this file the model was given to cite, so the review
   * records what was reviewable and not only what the chapters chose —
   * `coverage.ts` finds the difference. Absent on a skipped file, which had no
   * hunks to offer, and on every file when the executor returned no catalog.
   */
  hunks: z.array(ResolvedDiffHunkSchema).optional(),
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

export const ReviewRiskScoreSchema = z.literal([1, 2, 3, 4, 5]);
export type ReviewRiskScore = z.infer<typeof ReviewRiskScoreSchema>;

export const ReviewRiskFactorImpactSchema = z.enum(['raises', 'lowers', 'neutral']);
export type ReviewRiskFactorImpact = z.infer<typeof ReviewRiskFactorImpactSchema>;

export const ReviewRiskFactorSchema = z.object({
  name: z.string(),
  impact: ReviewRiskFactorImpactSchema,
  detail: z.string(),
});
export type ReviewRiskFactor = z.infer<typeof ReviewRiskFactorSchema>;

export const ReviewRiskAssessmentSchema = z.object({
  score: ReviewRiskScoreSchema,
  summary: z.string(),
  rationale: z.string(),
  factors: z.array(ReviewRiskFactorSchema),
});
export type ReviewRiskAssessment = z.infer<typeof ReviewRiskAssessmentSchema>;

export const NarrativeChapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: ProseSchema.optional(),
  insights: z.array(InsightSchema),
  diffChunks: z.array(DiffChunkSchema),
  /**
   * At most one diagram per chapter. One, not many: a chapter that earns three
   * pictures is a chapter that should have been split, and the reader is a
   * narrative rather than a slide deck.
   */
  diagram: DiagramSchema.optional(),
});
export type NarrativeChapter = z.infer<typeof NarrativeChapterSchema>;

export const NarrativeReviewSchema = z.object({
  prTitle: z.string(),
  overviewSummary: ProseSchema,
  riskAssessment: ReviewRiskAssessmentSchema.optional(),
  files: z.array(ReviewFileSchema).optional(),
  /**
   * The one diagram that is not chapter-scoped: the shape of the whole change,
   * and how the chapters relate to each other. Everything else belongs to the
   * chapter it explains.
   */
  overviewDiagram: DiagramSchema.optional(),
  chapters: z.array(NarrativeChapterSchema),
});
export type NarrativeReview = z.infer<typeof NarrativeReviewSchema>;

/**
 * Reserved ids for the reader's synthesised sections: two that precede the
 * first chapter, and one that follows the last when the chapters left hunks
 * uncited. They are not chapter ids and never come from the model — the
 * double underscores keep them out of the space a generated id can occupy.
 */
export const SUMMARY_SECTION_ID = '__summary__';
export const RISK_SECTION_ID = '__risk__';
export const UNDISCUSSED_SECTION_ID = '__undiscussed__';
