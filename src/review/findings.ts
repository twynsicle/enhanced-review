import { z } from 'zod';
import { plural } from './plural.ts';

/**
 * What validating a generated review found: every repair, every omission and
 * every reason to refuse the answer, in one list.
 *
 * The parsers are lenient by design — a nondeterministic producer sends back
 * something slightly wrong far more often than something unusable, and
 * throwing a whole review away over a dropped edge would be absurd. The
 * *record* is what makes that leniency safe to have: a repair made in silence
 * leaves a review that was pieced back together looking exactly like one that
 * arrived intact.
 *
 * Severity is the policy, and it is stated once, in `SEVERITY_BY_CODE`:
 *
 *   fatal    the completeness or correctness of the chapters and the hunks
 *            they show is in doubt. The run retries; if it still fails, the
 *            review does. A reader must never be handed a review with a hole
 *            in it that looks finished.
 *   warning  something *around* the chapters was lost — a summary, a diagram,
 *            an anchor — or the answer cost more to get than
 *            it should have. The review ships and the person who ran it is
 *            told.
 *   note     a repair that cost the reader nothing. Recorded so a pattern of
 *            them is visible, and nothing more.
 *
 * Findings are written to `findings.json` and read back by a `--from render` rerun,
 * so the shape is a Zod schema like everything else that crosses that
 * boundary.
 */
export const FindingSeveritySchema = z.enum(['fatal', 'warning', 'note']);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

const SEVERITY_BY_CODE = {
  /** No `<narrative_review>` block in the answer at all. */
  'answer-missing-block': 'fatal',
  /** The block is not JSON, and escaping stray quotes did not make it JSON. */
  'answer-unparseable': 'fatal',
  /** The assembled review failed `NarrativeReviewSchema`. */
  'answer-invalid': 'fatal',
  /** No prTitle, no overviewSummary prose, or no chapters array. */
  'fields-missing': 'fatal',
  /** A chapter left with no diffChunks once its hunk ids were resolved. */
  'chapter-no-hunks': 'fatal',
  /** A hunk the prompt showed that no chapter cites. */
  'hunk-uncited': 'fatal',
  /** The run ended on anything but a clean success (max turns, an SDK error). */
  'run-stopped-early': 'fatal',

  /** The risk assessment could not be used and the review ships without one. */
  'risk-dropped': 'warning',
  /** A whole diagram was dropped; the chapter it belonged to is unaffected. */
  'diagram-dropped': 'warning',
  /** An insight anchored to a file its chapter does not cite lost the anchor. */
  'insight-anchor-dropped': 'warning',
  /**
   * A judgement call the reviewer will never be asked. Unlike an insight, it
   * has nowhere else to go: it is drawn beside the lines it is about or not at
   * all, so an anchor that resolved against nothing costs the whole question.
   */
  'judgement-call-dropped': 'warning',
  /**
   * Cited hunks that came without a tier the reader knows, and were read as
   * `read`. Repaired to the more attentive tier, so nothing is faded on the
   * model's silence, but the reader's sense of where to look hard is the
   * model's to give and this review has less of it. One per review.
   */
  'hunk-tier-missing': 'warning',
  /**
   * The reading plan was missing, or named no chapter that exists for its
   * brief, and the review ships without one. Every chapter is still there; a
   * reader short of time has lost only the advice on which to read.
   */
  'reading-plan-dropped': 'warning',
  /**
   * A chapter's id repeated an earlier chapter's, or a reader section's, and
   * the chapter was given a fresh one. Every chapter is still drawn, but
   * anything in the answer naming that id — the reading plan above all —
   * now means the first holder, so a chapter can lose its place in the plan.
   */
  'chapter-id-duplicate': 'warning',
  /**
   * Excerpts of unchanged code that could not be shown: past the cap, too
   * long, a file the change touches, or a file or span the head commit does
   * not have. The chapters and their diffs are whole; the reader has lost a
   * pointer to code outside them. One per check, naming each excerpt and why.
   */
  'excerpt-dropped': 'warning',
  /** The sandbox refused commands the reviewer asked to run. */
  'commands-refused': 'warning',
  /** The first answer was disqualifying and a retry produced this one. */
  'passed-after-retry': 'warning',

  /** A chapter arrived without an id, so one was synthesised. */
  'chapter-id-synthesised': 'note',
  /** A chapter arrived without a title, so one was synthesised. */
  'chapter-title-synthesised': 'note',
  /** Prose arrived as a bare string, or as a body with no lede, and was promoted. */
  'prose-promoted': 'note',
  /** Prose arrived with nothing readable in it, so a chapter has none. */
  'prose-dropped': 'note',
  /** A chapter's diff chunk that named no file, or listed no hunk id to resolve. */
  'chunk-dropped': 'note',
  /** The JSON parsed only after a quote the model forgot to escape was escaped. */
  'json-quote-repaired': 'note',
  /** A chapter showed one file twice — two chunks, or one hunk cited twice — and the repeat went. */
  'chunks-merged': 'note',
  /** An insight's type is not one of the three, and fell back to `context`. */
  'insight-type-unknown': 'note',
  /** A hunk id a surviving judgement call cited that resolved against nothing. */
  'judgement-hunk-id-dropped': 'note',
  /** An insight with no text to show was dropped. */
  'insight-dropped': 'note',
  /** Part of a diagram went: a node, an edge, a group, a filename, a hunk id. */
  'diagram-part-dropped': 'note',
  /** A hunk id that resolved against nothing, in a chapter that survived. */
  'hunk-id-dropped': 'note',
  /** Part of the risk assessment went: a factor, an impact, a summary. */
  'risk-part-dropped': 'note',
  /**
   * Hunks a judgement call asks about, raised to `read` on the card that draws
   * the call. The model contradicted itself, asking about lines it said needed
   * no reading, and the question is the better evidence. One per review.
   */
  'hunk-tier-raised': 'note',
  /**
   * Hunks the model tiered `read` that the CLI proved change only whitespace or imports,
   * skimmed: there is nothing in them to read. One per review.
   */
  'hunk-tier-lowered': 'note',
  /**
   * Skim reasons longer than a label, dropped: the hunk stays skim and is
   * labelled "Skim" alone rather than with a sentence over its code. One per
   * review.
   */
  'skim-reason-dropped': 'note',
  /** Ids in the reading plan that named no chapter, or a chapter twice, and went. */
  'reading-plan-id-dropped': 'note',
  /**
   * Brief chapters the standard plan left out, added to it: the longer plan
   * that skips what the shorter one calls essential is a contradiction, and
   * the brief is the better evidence of what matters.
   */
  'reading-plan-widened': 'note',
} as const satisfies Record<string, FindingSeverity>;

export type FindingCode = keyof typeof SEVERITY_BY_CODE;

/** The one map from finding code to severity. Nothing else decides this. */
export const FINDING_SEVERITY: Readonly<Record<FindingCode, FindingSeverity>> = SEVERITY_BY_CODE;

export const FindingCodeSchema = z.enum(
  Object.keys(SEVERITY_BY_CODE) as [FindingCode, ...FindingCode[]],
);

export const FindingSchema = z.object({
  code: FindingCodeSchema,
  severity: FindingSeveritySchema,
  /**
   * One self-contained sentence naming the defect. It is read by a person
   * looking at a finished review, and sent back to the model as the reason a
   * stop was blocked, so it must make sense with nothing else around it.
   */
  message: z.string(),
  chapterId: z.string().optional(),
  filename: z.string().optional(),
  hunkIds: z.array(z.string()).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const FindingsSchema = z.array(FindingSchema);

export type FindingLocation = Pick<Finding, 'chapterId' | 'filename' | 'hunkIds'>;

export function finding(
  code: FindingCode,
  message: string,
  location: FindingLocation = {},
): Finding {
  return { code, severity: FINDING_SEVERITY[code], message, ...location };
}

/**
 * Where a pass collects what it found. Passed down into the sanitisers so a
 * repair is recorded at the point it is made — anywhere else and the record
 * is a reconstruction, which is the thing this exists to stop.
 */
export interface FindingLog {
  readonly findings: Finding[];
  /** Returns what it recorded, for a caller that wants the finding itself. */
  add(code: FindingCode, message: string, location?: FindingLocation): Finding;
}

export function findingLog(): FindingLog {
  const findings: Finding[] = [];
  return {
    findings,
    add(code, message, location) {
      const recorded = finding(code, message, location);
      findings.push(recorded);
      return recorded;
    },
  };
}

export function fatalFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((item) => item.severity === 'fatal');
}

/**
 * The two findings a run earns by how it behaved rather than by what it said.
 */
export function runStoppedEarly(ended: string): Finding {
  return finding(
    'run-stopped-early',
    `The run did not finish cleanly (${ended}), so the reviewer stopped short of the change. Raise --max-turns or --timeout and run again from the run stage.`,
  );
}

/** One excerpt that will not be shown, and why, for `excerptsDropped`. */
export interface ExcerptDrop {
  chapterId: string;
  /** The excerpt as the model gave it: a path and span, or what was wrong with it. */
  excerpt: string;
  why: string;
}

/**
 * Every excerpt one check dropped, in one finding. The parser and the parse
 * stage each check what only they can see, so a review can carry one of each.
 */
export function excerptsDropped(drops: readonly ExcerptDrop[]): Finding {
  const listed = drops
    .map((drop) => `${drop.excerpt} in chapter ${drop.chapterId} (${drop.why})`)
    .join('; ');
  return finding(
    'excerpt-dropped',
    `${plural(drops.length, 'excerpt')} of unchanged code ${drops.length > 1 ? 'were' : 'was'} dropped: ${listed}.`,
  );
}

export function passedAfterRetry(attempts: number): Finding {
  return finding(
    'passed-after-retry',
    `The reviewer's first answer was disqualified; this review is what it sent after ${plural(attempts, 'further attempt')}.`,
  );
}
