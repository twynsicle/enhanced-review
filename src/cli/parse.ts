import { readFile, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { plural } from '../review/plural.ts';
import { withFileHunks } from '../review/coverage.ts';
import { howItEnded } from './sdk-loop.ts';
import {
  fatalFindings,
  finding,
  passedAfterRetry,
  runStoppedEarly,
  FindingsSchema,
  type Finding,
} from '../review/findings.ts';
import { NarrativeReviewSchema, type NarrativeReview } from '../review/narrative.ts';
import { groundingFor, type PromptGrounding } from '../review/prompt/diff-hunk-catalog.ts';
import { validateReview } from '../review/validate-review.ts';
import type { RunContext } from './context.ts';
import type { RunFiles } from './run-folder.ts';

/**
 * The parse stage: `raw.txt` through the same verdict the run's Stop hook gave,
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
  const findings = [...validation.findings, ...(await runFindings(run))];

  const fatal = fatalFindings(findings);
  if (fatal.length > 0) {
    // The record of why this failed outlives the terminal it was printed to,
    // and `readFindings` refuses a file carrying a fatal one, so no later
    // stage can draw on this run without being told. Any `review.json` an
    // earlier parse left goes with it: `--from render` reads that file, and a
    // review from some previous answer would be drawn as though it were this
    // run's.
    await writeFile(run.findings, `${JSON.stringify(findings, null, 2)}\n`);
    await rm(run.review, { force: true });
    // Only a defect in the answer itself can be fixed in `raw.txt`. A run that
    // stopped early is about turns the reviewer never took, and offering an
    // edit-and-reparse for that contradicts the finding's own instruction.
    const inTheAnswer = !fatal.some((item) => item.code === 'run-stopped-early');
    throw new Error(
      fatal.map((item) => item.message).join(' ') +
        (inTheAnswer
          ? ` The model's answer is in ${run.raw}; ` +
            'fix it there and rerun with --from parse, or run again for a fresh answer.'
          : ''),
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

/**
 * What the run itself cost the review, as findings. Every run stage writes an
 * event log, `--stub` included, so its absence is not "no model ran" — it is
 * a run nobody has any record of, which is exactly what a clean parse must not
 * be mistaken for.
 *
 * A blocked stop earns `passed-after-retry` with nothing asked about the
 * answer that followed it: an answer still disqualified after those blocks
 * fails in `parseRun`, which throws before any of this is written or read.
 */
async function runFindings(run: RunFiles): Promise<Finding[]> {
  let log: string;
  try {
    log = await readFile(run.events, 'utf8');
  } catch (error) {
    // Only a missing file is a fact about the run. Anything else — a
    // permission, a bad handle — is a fact about this machine, and swallowing
    // it would report a defect in the review that is nothing of the kind.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return [
      finding(
        'run-stopped-early',
        `There is no record of how the run ended: ${run.events} is not there. Run again from the run stage.`,
      ),
    ];
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
    // Nothing the parse stage can be told to do clears this: the finding is
    // about turns the reviewer never took, so the only fix is another run.
    findings.push(runStoppedEarly(ended));
    return findings;
  }

  const blocked = events.filter((event) => event.type === 'blocked').length;
  if (blocked > 0) findings.push(passedAfterRetry(blocked));
  return findings;
}

/**
 * What the last parse recorded. The render stage has no answer in front of it,
 * so this is the only thing that knows whether the review it is about to draw
 * shipped with something lost — and a `--from render` that says nothing about
 * a warned review is the same silence the findings exist to end.
 */
export async function readFindings(run: RunFiles): Promise<Finding[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(run.findings, 'utf8'));
  } catch (error) {
    // A file cut off mid-write is the same fact about the run as a missing
    // one — there is no record to draw on — and is worth saying so rather
    // than raising a bare SyntaxError from a stage that never mentioned JSON.
    // Anything else is a fact about this machine, not about the run.
    if (error instanceof SyntaxError) {
      throw new Error(`${run.findings} was not fully written; run from parse`, { cause: error });
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`no findings.json in ${run.folder}; run from parse`, { cause: error });
  }
  const parsed = FindingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${run.findings} is not a list of findings: ${parsed.error.message}`);
  }
  const fatal = fatalFindings(parsed.data);
  if (fatal.length > 0) {
    throw new Error(
      `the last parse failed; run from parse. ${fatal.map((item) => item.message).join(' ')}`,
    );
  }
  return parsed.data;
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
