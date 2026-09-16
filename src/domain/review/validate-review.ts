import { citedHunkIds } from './coverage.ts';
import { findingLog, type Finding, type FindingLog } from './findings.ts';
import type { NarrativeReview } from './narrative.ts';
import type { PromptGrounding } from './prompt/diff-hunk-catalog.ts';
import { parseNarrativeReview } from './prompt/parse-narrative.ts';

/**
 * The single verdict on a model's answer: parse it, then hold it against the
 * hunks the prompt showed. Everything that runs a review — the Stop hook that
 * decides whether to ask again, the hosted executor, the local CLI — asks
 * this, so all three judge an answer by the same rules.
 *
 * `review` is what parsed, which can be a perfectly well-formed review that
 * is nonetheless disqualified by a finding. Callers decide on
 * `isFatal(findings)`, never on `review !== null` alone.
 */
export interface ReviewValidation {
  review: NarrativeReview | null;
  findings: Finding[];
}

/**
 * How many uncited ids the message names before it gives up and counts. The
 * sentence is read by a person and sent back to the model, and a change with
 * hundreds of uncited hunks is not one more id away from being understood.
 */
const MAX_LISTED_HUNKS = 20;

export function validateReview(text: string, grounding?: PromptGrounding): ReviewValidation {
  const parsed = parseNarrativeReview(text, grounding);
  if (!parsed.ok) return { review: null, findings: parsed.findings };

  const log = findingLog();
  reportUncitedHunks(parsed.data, grounding, log);
  return { review: parsed.data, findings: [...parsed.findings, ...log.findings] };
}

/**
 * The prompt tells the model every hunk it is shown must be placed in a
 * chapter. A hunk that no chapter cites is a change nobody reading the review
 * would ever see, which is the one thing a review may not do, so it
 * disqualifies the answer rather than being quietly reported underneath it.
 *
 * Measured against what the prompt *showed*, never the whole catalog: a diff
 * too big to fit was cut before the model ever saw it, and blaming the model
 * for hunks it was not given would make truncation unreviewable. Truncation
 * has its own finding.
 */
function reportUncitedHunks(
  review: NarrativeReview,
  grounding: PromptGrounding | undefined,
  log: FindingLog,
): void {
  if (!grounding || grounding.shown.hunks.length === 0) return;
  const cited = citedHunkIds(review.chapters);
  const uncited = grounding.shown.hunks.filter((hunk) => !cited.has(hunk.id));
  if (uncited.length === 0) return;

  const byFile = new Map<string, string[]>();
  for (const hunk of uncited.slice(0, MAX_LISTED_HUNKS)) {
    const ids = byFile.get(hunk.filename) ?? [];
    ids.push(hunk.id);
    byFile.set(hunk.filename, ids);
  }
  const listed = [...byFile.entries()]
    .map(([filename, ids]) => `${ids.join(', ')} (${filename})`)
    .join('; ');
  const rest = uncited.length - Math.min(uncited.length, MAX_LISTED_HUNKS);
  const tail = rest > 0 ? `, and ${String(rest)} more` : '';

  log.add('hunk-uncited', `These hunks are cited by no chapter: ${listed}${tail}.`, {
    hunkIds: uncited.map((hunk) => hunk.id),
  });
}
