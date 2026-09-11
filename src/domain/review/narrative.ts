import { z } from 'zod';
import { DiagramSchema } from './diagram.ts';

/**
 * The narrative review shape: what the executor produces, what
 * `reviews.content` stores and what the reader renders. Shared by server and
 * browser, so nothing here may touch Node or the db.
 *
 * Zod is the source of truth; the exported types are inferred from it so the
 * schema that parses `reviews.content` at the db boundary and the type the
 * components consume cannot drift apart. The schema is deliberately lenient
 * where older reviews may lack a field (`title` on insights, `description`,
 * `riskAssessment`, `files`).
 */
export const InsightTypeSchema = z.enum(['context', 'rationale', 'highlight', 'reference']);
export type InsightType = z.infer<typeof InsightTypeSchema>;

export const InsightSchema = z.object({
  type: InsightTypeSchema,
  /** Short headline (4–10 words) naming the takeaway. Absent on older reviews. */
  title: z.string().optional(),
  text: z.string(),
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
  description: z.string().optional(),
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
  overviewSummary: z.string(),
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
 * Reserved ids for the reader's two synthesised sections, which precede the
 * first chapter. They are not chapter ids and never come from the model —
 * the double underscores keep them out of the space a generated id can
 * occupy.
 */
export const SUMMARY_SECTION_ID = '__summary__';
export const RISK_SECTION_ID = '__risk__';
