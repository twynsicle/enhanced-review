import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { plural } from '../common/plural.ts';
import { withFileHunks } from '../domain/review/coverage.ts';
import { fatalFindings, finding, isFatal, type Finding } from '../domain/review/findings.ts';
import { NarrativeReviewSchema, type NarrativeReview } from '../domain/review/narrative.ts';
import { groundingFor, type PromptGrounding } from '../domain/review/prompt/diff-hunk-catalog.ts';
import { validateReview } from '../domain/review/validate-review.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The parse stage: `raw.txt` through the same verdict the hosted review uses,
 * with hunk ids resolved against the catalog gather wrote, and the changed
 * file list attached from context rather than trusted from the model. Each
 * file carries its share of that catalog, so the report knows what was
 * reviewable and not only what was cited.
 *
 * What the answer cost is two things joined: what validating the answer found,
 * and what the run itself did. The second is read back from `events.jsonl`
 * rather than passed down from the run stage, so `--from parse` reports the
 * same findings a full run did without paying for the model again.
 */
export interface ParsedRun {
  review: NarrativeReview;
  /** Every severity, in the order found; `findings.json` is this list. */
  findings: Finding[];
}

export async function parseRun(context: RunContext, run: RunFiles): Promise<ParsedRun> {
  let raw: string;
  try {
    raw = await readFile(run.raw, 'utf8');
  } catch {
    throw new Error(`no raw.txt in ${run.folder}; run from an earlier stage`);
  }
  const validation = validateReview(raw, groundingForRun(context));
  const findings = [...validation.findings, ...(await runFindings(run, validation.findings))];

  const fatal = fatalFindings(findings);
  if (fatal.length > 0) {
    throw new Error(
      `${fatal.map((item) => item.message).join(' ')} The model's answer is in ${run.raw}; ` +
        'fix it there and rerun with --from parse, or run again for a fresh answer.',
    );
  }
  if (!validation.review) {
    // Unreachable: an answer that did not parse carries a fatal finding.
    throw new Error(`the answer in ${run.raw} is not a usable review`);
  }

  const review: NarrativeReview = {
    ...validation.review,
    files: withFileHunks(context.files, context.hunks),
  };
  await writeFile(run.review, `${JSON.stringify(review, null, 2)}\n`);
  await writeFile(run.findings, `${JSON.stringify(findings, null, 2)}\n`);
  return { review, findings };
}

function reviewedFiles(context: RunContext): string[] {
  return context.files.filter((file) => !file.skipped).map((file) => file.filename);
}

/** The grounding the run stage holds the model's answer against. */
export function groundingForRun(context: RunContext): PromptGrounding {
  return groundingFor(context.hunks, reviewedFiles(context));
}

/** One line per SDK message; only the fields findings are drawn from. */
const RunEventSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  isError: z.boolean().optional(),
});
type RunEvent = z.infer<typeof RunEventSchema>;

/**
 * A line of the event log, or nothing. A run killed mid-write leaves a
 * half-written last line, which is not worth failing a review over — the
 * findings it would have carried are about the run, and a run that was killed
 * has the bigger problem already.
 */
function readEvent(line: string): RunEvent[] {
  if (line === '') return [];
  try {
    const parsed = RunEventSchema.safeParse(JSON.parse(line) as unknown);
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

/** How the run ended, when that was not a clean success; null when it was. */
function howItEnded(result: RunEvent | undefined): string | null {
  if (!result) return 'no result';
  if (result.subtype !== 'success') return result.subtype ?? 'unknown';
  return result.isError === true ? 'error' : null;
}

/**
 * What the run itself cost the review, as findings. `--stub` writes no event
 * log at all, and a missing one says only that no model was run.
 */
async function runFindings(run: RunFiles, answerFindings: Finding[]): Promise<Finding[]> {
  let log: string;
  try {
    log = await readFile(run.events, 'utf8');
  } catch {
    return [];
  }

  const events = log.split('\n').flatMap(readEvent);

  const findings: Finding[] = [];
  const denied = events.filter((event) => event.type === 'denied').length;
  if (denied > 0) {
    findings.push(
      finding(
        'commands-refused',
        `The review asked to run ${plural(denied, 'command')} the sandbox refused; each one cost it a turn. They are in ${run.events}.`,
      ),
    );
  }

  // A run that ended on anything but a clean success reviewed less than it was
  // asked to, whatever its answer looks like: the turns it never took are
  // files it never read.
  const result = events.findLast((event) => event.type === 'result');
  const ended = howItEnded(result);
  if (ended !== null) {
    findings.push(
      finding(
        'run-stopped-early',
        `The run did not finish cleanly (${ended}), so the reviewer stopped short of the change. ` +
          'Raise --max-turns, or edit raw.txt and use --from parse.',
      ),
    );
    return findings;
  }

  const blocked = events.filter((event) => event.type === 'blocked').length;
  if (blocked > 0 && !isFatal([...answerFindings, ...findings])) {
    findings.push(
      finding(
        'passed-after-retry',
        `The reviewer's first answer was disqualified; this review is what it sent after ${plural(blocked, 'further attempt')}.`,
      ),
    );
  }
  return findings;
}

export async function readReview(run: RunFiles): Promise<NarrativeReview> {
  let raw: string;
  try {
    raw = await readFile(run.review, 'utf8');
  } catch {
    throw new Error(`no review.json in ${run.folder}; run from an earlier stage`);
  }
  const parsed = NarrativeReviewSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`${run.review} is not a review: ${parsed.error.message}`);
  return parsed.data;
}
