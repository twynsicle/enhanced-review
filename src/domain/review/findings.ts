import { z } from 'zod';

/**
 * What validating a generated review found: every repair, every omission and
 * every reason to refuse the answer, in one list.
 *
 * The parsers are lenient by design — a nondeterministic producer sends back
 * something slightly wrong far more often than something unusable, and
 * throwing a whole review away over a dropped edge would be absurd. What was
 * missing until now was the *record*: the repair happened in silence, so
 * nobody could tell a review that arrived intact from one that was pieced
 * back together.
 *
 * Severity is the policy, and it is stated once, in `SEVERITY_BY_CODE`:
 *
 *   fatal    the completeness or correctness of the chapters and the hunks
 *            they show is in doubt. The run retries; if it still fails, the
 *            review does. A reader must never be handed a review with a hole
 *            in it that looks finished.
 *   warning  something *around* the chapters was lost — a summary, a diagram,
 *            an anchor, a truncated diff. The review ships and the person who
 *            ran it is told.
 *   note     a repair that cost the reader nothing. Recorded so a pattern of
 *            them is visible, and nothing more.
 *
 * Findings are stored (`reviews.findings`) and read back, so the shape is a
 * Zod schema like everything else that crosses that boundary.
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
  /** The diff did not fit the prompt, so part of the change was never shown. */
  'diff-truncated': 'warning',
  /** The sandbox refused commands the reviewer asked to run (`er` only). */
  'commands-refused': 'warning',
  /** The first answer was disqualifying and a retry produced this one. */
  'passed-after-retry': 'warning',

  /** A chapter arrived without an id, so one was synthesised. */
  'chapter-id-synthesised': 'note',
  /** A chapter arrived without a title, so one was synthesised. */
  'chapter-title-synthesised': 'note',
  /** Prose arrived as a bare string, or as a body with no lede, and was promoted. */
  'prose-promoted': 'note',
  /** The JSON parsed only after a quote the model forgot to escape was escaped. */
  'json-quote-repaired': 'note',
  /** A chapter named one file in two chunks; they were merged into one. */
  'chunks-merged': 'note',
  /** An insight's type is not one of the four, and fell back to `context`. */
  'insight-type-unknown': 'note',
  /** An insight with no text to show was dropped. */
  'insight-dropped': 'note',
  /** Part of a diagram went: a node, an edge, a group, a filename, a hunk id. */
  'diagram-part-dropped': 'note',
  /** A hunk id that resolved against nothing, in a chapter that survived. */
  'hunk-id-dropped': 'note',
  /** Part of the risk assessment went: a factor, an impact, a summary. */
  'risk-part-dropped': 'note',
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
  /** Returns what it recorded, so a fatal path can report the same sentence. */
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

export function isFatal(findings: readonly Finding[]): boolean {
  return findings.some((item) => item.severity === 'fatal');
}

/** Severity totals, for a log line that has no room for the findings themselves. */
export function countBySeverity(findings: readonly Finding[]): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = { fatal: 0, warning: 0, note: 0 };
  for (const item of findings) counts[item.severity] += 1;
  return counts;
}
