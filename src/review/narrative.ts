import { z } from 'zod';
import { DiagramSchema } from './diagram.ts';

/**
 * The narrative review shape: what the model's answer is parsed into, and
 * what the report renders. Read by the CLI and the report alike, so nothing
 * here may touch Node.
 *
 * Zod is the source of truth; the exported types are inferred from it so the
 * schema that parses the model's answer and the type the components consume
 * cannot drift apart. A field is optional here only when a
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

export const InsightTypeSchema = z.enum(['context', 'rationale', 'highlight']);
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

/** At most three judgement calls in a review, and most reviews earn none. */
export const MAX_JUDGEMENT_CALLS = 3;

/**
 * A decision in the change whose correctness needs a human, because the fact
 * that settles it is not in the repository: expected volume, what is coming
 * next, who depends on the current behaviour, a product call.
 *
 * Not an `Insight`, for two reasons. An insight tells the reviewer something;
 * this asks them something, and the two read differently enough that sharing a
 * type would blur both. More practically, insights are budgeted per chapter,
 * so a twelve-chapter review may hold thirty of them — right for a reviewer
 * aid and wrong for a question, which is worth reading precisely because there
 * are two of them and not thirty. The budget therefore has to be review-wide,
 * and a review-wide cap cannot be enforced on a chapter-scoped array.
 *
 * `filename` and `hunkIds` are required rather than optional: a question is
 * only answerable beside the lines that prompted it, and one the reader meets
 * before any code is a question about nothing in particular. The path must be
 * one a chapter cites, so there is a diff card for the question to sit on.
 */
export const JudgementCallSchema = z.object({
  /** Short headline naming the decision, not the question. */
  title: z.string(),
  text: z.string(),
  filename: z.string(),
  /** Ids from the prompt's catalog, all belonging to `filename`. */
  hunkIds: z.array(z.string()).nonempty(),
});
export type JudgementCall = z.infer<typeof JudgementCallSchema>;

export const DiffLineSpanSchema = z.object({
  startLine: z.number().int(),
  lineCount: z.number().int(),
});
export type DiffLineSpan = z.infer<typeof DiffLineSpanSchema>;

/**
 * The other end of a hunk's move: the file whose hunk removed the lines this
 * one added (`movedFrom`), or added the lines this one removed (`movedTo`).
 * `similarity` is how much of the block survived the move: of the significant
 * lines the two hunks share, the smaller of their percentage of the adding
 * hunk's lines and of the removing hunk's, the same number at both ends.
 */
export const HunkMoveSchema = z.object({
  filename: z.string(),
  similarity: z.number().int().min(0).max(100),
});
export type HunkMove = z.infer<typeof HunkMoveSchema>;

/**
 * What the CLI can prove about a hunk from the patch alone
 * (`prompt/hunk-facts.ts`). The model is shown them as hints and the reader
 * draws them as tags. A hunk that is whitespace only, or moved unchanged, is
 * skim whatever the model says (`provenSkim`): there is nothing new in it to
 * read.
 */
export const HunkFactsSchema = z.object({
  whitespaceOnly: z.literal(true).optional(),
  movedFrom: HunkMoveSchema.optional(),
  movedTo: HunkMoveSchema.optional(),
});
export type HunkFacts = z.infer<typeof HunkFactsSchema>;

export const ResolvedDiffHunkSchema = HunkFactsSchema.extend({
  id: z.string(),
  fileOrder: z.number().int(),
  original: DiffLineSpanSchema,
  modified: DiffLineSpanSchema,
  /**
   * The lines the hunk adds and removes, git's context lines left out: what a
   * reader actually has to read, where the spans also count the unchanged
   * lines around it.
   */
  changedLines: z.number().int().min(0),
});
export type ResolvedDiffHunk = z.infer<typeof ResolvedDiffHunkSchema>;

/** The proven facts that make a hunk skim, whatever tier the model gave it. */
export function provenSkim(facts: HunkFacts): boolean {
  return (
    facts.whitespaceOnly === true ||
    facts.movedFrom?.similarity === 100 ||
    facts.movedTo?.similarity === 100
  );
}

/**
 * How hard a reviewer must look at a hunk: `read` is what judging the change
 * rests on, `skim` is needed to follow the story. Nothing is folded away for
 * either; the reader draws skim lines faded, in place among the read ones.
 */
export const HunkTierSchema = z.enum(['read', 'skim']);
export type HunkTier = z.infer<typeof HunkTierSchema>;

/** A hunk as a chapter cites it. */
export const CitedHunkSchema = ResolvedDiffHunkSchema.extend({
  tier: HunkTierSchema,
});
export type CitedHunk = z.infer<typeof CitedHunkSchema>;

export const DiffChunkSchema = z.object({
  filename: z.string(),
  language: z.string(),
  hunks: z.array(CitedHunkSchema),
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

/**
 * Where a renamed or copied file came from, and git's similarity index for
 * the pair: the percentage of the old content that survives in the new.
 */
export const ReviewFileOriginSchema = z.object({
  filename: z.string(),
  similarity: z.number().int().min(0).max(100),
});
export type ReviewFileOrigin = z.infer<typeof ReviewFileOriginSchema>;

export const ReviewFileSchema = z.object({
  filename: z.string(),
  status: ReviewFileStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  /** Set on a renamed or copied file, and on no other. */
  origin: ReviewFileOriginSchema.optional(),
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

/** At most two excerpts a chapter, each at most sixty lines. */
export const MAX_CONTEXT_EXCERPTS = 2;
export const MAX_EXCERPT_LINES = 60;

/**
 * Unchanged code whose behaviour the chapter's change alters without editing
 * it — a caller, a subclass, a contract — or a definition the changed code now
 * leans on in a way the diff hides. Never a file the change touches: its lines
 * are read at the head commit, and a changed file already has a diff to read.
 *
 * Lines are 1-based and inclusive, as an editor numbers them at the head
 * commit. The parser holds the span to the cap; the parse stage holds it to
 * the file, which only git can see.
 */
export const ContextExcerptSchema = z.object({
  filename: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  /** One sentence: what this code has to do with the change. */
  reason: z.string(),
});
export type ContextExcerpt = z.infer<typeof ContextExcerptSchema>;

export const NarrativeChapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: ProseSchema.optional(),
  insights: z.array(InsightSchema),
  diffChunks: z.array(DiffChunkSchema),
  /** Absent and empty mean the same: nothing outside the diff needed showing. */
  contextExcerpts: z.array(ContextExcerptSchema).max(MAX_CONTEXT_EXCERPTS).optional(),
  /**
   * At most one diagram per chapter. One, not many: a chapter that earns three
   * pictures is a chapter that should have been split, and the reader is a
   * narrative rather than a slide deck.
   */
  diagram: DiagramSchema.optional(),
});
export type NarrativeChapter = z.infer<typeof NarrativeChapterSchema>;

/**
 * Which chapters to read with less than the whole review's time, as chapter
 * ids in chapter order. `brief` is where the change's risk is, what someone
 * with five minutes must read to judge it, and being in it is what makes a
 * chapter core: there is no separate weight to disagree with it. `standard`
 * is what approving the change needs, and always holds `brief`. Reading
 * everything is the third plan, and needs no field.
 *
 * Minutes are not stored. The reader computes them from the chapters
 * themselves, so a plan cannot claim a time its chapters do not add up to.
 */
export const ReadingPlanSchema = z.object({
  brief: z.array(z.string()).nonempty(),
  standard: z.array(z.string()).nonempty(),
});
export type ReadingPlan = z.infer<typeof ReadingPlanSchema>;

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
  /** The order chapters are read in: a cause before its consequences. */
  chapters: z.array(NarrativeChapterSchema),
  /** Absent when the model's plan could not be used; see `ReadingPlanSchema`. */
  readingPlan: ReadingPlanSchema.optional(),
  /**
   * Review-wide rather than per chapter, and capped: see `JudgementCallSchema`.
   * Absent and empty mean the same thing — no decision here needed a human —
   * which is the common case and not a defect.
   */
  judgementCalls: z.array(JudgementCallSchema).max(MAX_JUDGEMENT_CALLS).optional(),
});
export type NarrativeReview = z.infer<typeof NarrativeReviewSchema>;

/**
 * Reserved ids for the two reader sections that precede the first chapter.
 * They are not chapter ids and never come from the model — the double
 * underscores keep them out of the space a generated id can occupy.
 */
export const SUMMARY_SECTION_ID = '__summary__';
export const RISK_SECTION_ID = '__risk__';
