import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { mapLimit } from '../cli/git-runner.ts';
import { agentEnv } from '../cli/host-env.ts';
import { howItEnded, runSdkLoop, type SdkQueryFn } from '../cli/sdk-loop.ts';
import { RATINGS, RatingSchema, type Rating } from '../report/sheet/sheet-data.ts';
import { isGraphDiagram, type Diagram } from '../review/diagram.ts';
import type { DiagramBranchSpec } from './diagram-case.ts';
import type { BranchScore } from './diagram-score.ts';

/**
 * The rubric judge: a model reads each overview of a sweep as text — never
 * the rendered picture, whose layout is the eye's to judge on the contact
 * sheet — and rates it against the branch's question and mechanisms. Two
 * judge models by default, since the model that drew a diagram may favour
 * its own work. A judge's ratings are worth quoting only once they agree with
 * the user's own, which `diagram-agree.ts` measures.
 *
 *   <sweep>/judgements/
 *     judgements.json                     the judges, when they ran, what they cost
 *     <model>/<branch>/sample-<n>.txt     the judge's answer
 *     <model>/<branch>/sample-<n>.json    how it ended and what it cost
 */
export const DEFAULT_JUDGES = ['claude-opus-5-5', 'claude-sonnet-5-5'];

const SHOWN = ['yes', 'partly', 'no'] as const;
type Shown = (typeof SHOWN)[number];

export const JudgeRecordSchema = z.object({
  judges: z.array(z.string()),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
});
export type JudgeRecord = z.infer<typeof JudgeRecordSchema>;

export const JudgeMetaSchema = z.object({
  ms: z.number(),
  costUsd: z.number().nullable(),
  /** How the query ended when not cleanly; null for a finished answer. */
  ended: z.string().nullable(),
});
export type JudgeMeta = z.infer<typeof JudgeMetaSchema>;

export const RUBRIC = `- "good": a reader who has never seen the code answers the question from the picture and its caption alone, every mechanism is shown, and the work can be followed from where it enters to where it ends.
- "usable": the question can be answered, but a mechanism is only partly shown or missing, the work starts or stops somewhere in the middle, or the picture carries noise the reader has to look past.
- "poor": the question cannot be answered from the picture, or it shows something the change does not do.`;

export const JUDGE_SYSTEM_PROMPT = `You judge one diagram from a code review. The review explained a change to a reader who has never seen the code, and this diagram was its overview: the one picture meant to show the shape of the change and where it sits in the running system. You are given what the change really does, the question the overview should answer on its own, and the mechanisms it should show. You see the diagram as text, not as a picture; judge what it says, not how it would be laid out.

How to read the diagram:
- Each node is a part, with its kind (code, data, external, actor), what the change did to it (added, modified, removed, unchanged) and, when it has one, the file or folder it lives in. A folder ends in "/".
- Each edge is "from → to", with what passes along it and what the change did to it.
- A "beforeAfter" diagram is one graph drawn twice: the before side is everything not added, the after side everything not removed.

What makes an overview easy to follow, beyond answering the question:
- where the work comes in: the client, operator, schedule, queue or route that sets it moving;
- where it goes out: what it stores, the reply it sends, the job it hands on, the outside service it tells;
- the parts outside the change it connects to, drawn and marked unchanged;
- each crossing of a boundary labelled with how it crosses: the route and verb, the reply, the queue, table or event;
- parts grouped by the area of the system they belong to;
- a path the change stops taking drawn as a removed edge, even when both its ends remain.
More parts and connections help, as long as each is on the path the change takes: do not mark a picture down for its size.

Work in this order, and do not skip the first step:
1. Answer the question in two or three sentences, using only the diagram, its title and its caption. Where the diagram does not say, write that it does not.
2. For each mechanism, in the order given, say whether the diagram shows it: "yes", "partly" or "no".
3. Rate the diagram:
${RUBRIC}
   Give one sentence of why.

Answer with one block and nothing after it:
<diagram_judgement>
{"answer": "...", "mechanisms": [{"mechanism": "...", "shown": "yes"}], "rating": "good", "reason": "..."}
</diagram_judgement>`;

/** A graph diagram as the judge reads it: one line a node, one line an edge. */
export function describeDiagram(diagram: Diagram): string {
  if (!isGraphDiagram(diagram)) {
    throw new Error(
      `an overview is a graph, not a ${diagram.kind}; the judge has no reading for one`,
    );
  }
  const labels = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  const groups = new Map((diagram.groups ?? []).map((group) => [group.id, group.label]));
  const node = (item: (typeof diagram.nodes)[number]) =>
    `- ${item.label} (${item.kind}, ${item.change})` +
    (item.filename ? ` in ${item.filename}` : '') +
    (item.group && groups.has(item.group) ? `, inside "${groups.get(item.group)!}"` : '');
  const edge = (item: (typeof diagram.edges)[number]) =>
    `- ${labels.get(item.from) ?? item.from} → ${labels.get(item.to) ?? item.to}` +
    (item.label ? `: ${item.label}` : '') +
    ` (${item.change})`;
  return [
    `Kind: ${diagram.kind}`,
    `Title: ${diagram.title}`,
    `Caption: ${diagram.caption}`,
    'Nodes:',
    ...diagram.nodes.map(node),
    'Edges:',
    ...(diagram.edges.length > 0 ? diagram.edges.map(edge) : ['- none']),
  ].join('\n');
}

export function buildJudgePrompt(spec: DiagramBranchSpec, overview: Diagram): string {
  return [
    `# The change: ${spec.title}`,
    spec.description,
    '# The question the overview should answer',
    spec.expect.question,
    '# The mechanisms it should show',
    ...spec.expect.mustName.map((mechanism) => `- ${mechanism}`),
    '# The overview',
    describeDiagram(overview),
  ].join('\n\n');
}

export interface Judgement {
  answer: string;
  mechanisms: Shown[];
  rating: Rating;
  reason: string;
}

export interface ParsedJudgement {
  /** null when the answer did not hold a clean judgement. */
  judgement: Judgement | null;
  /** Everything short of a clean judgement, one line each. */
  problems: string[];
}

const OPEN = '<diagram_judgement>';
const CLOSE = '</diagram_judgement>';

const failed = (problem: string): ParsedJudgement => ({ judgement: null, problems: [problem] });

/**
 * Read strictly, as the skim eval reads its answers: an eval has to count
 * what the judge actually said, so anything short of a clear rating, reason
 * and verdict on each mechanism is a problem on the record and no judgement.
 */
export function parseJudgement(text: string, mechanisms: number): ParsedJudgement {
  const start = text.lastIndexOf(OPEN);
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start + OPEN.length);
  if (start < 0 || end < 0) return failed(`no ${OPEN} block in the answer`);
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start + OPEN.length, end));
  } catch (error) {
    return failed(`the block is not JSON: ${(error as Error).message}`);
  }
  if (typeof value !== 'object' || value === null) return failed('the block is not an object');
  const fields = value as Record<string, unknown>;
  const problems: string[] = [];
  const required = (key: string): string | undefined => {
    const field = fields[key];
    if (typeof field === 'string' && field.trim() !== '') return field.trim();
    problems.push(`no ${key}`);
    return undefined;
  };
  const answer = required('answer');
  const reason = required('reason');
  const rating = RatingSchema.safeParse(fields.rating);
  if (!rating.success)
    problems.push(`rating ${JSON.stringify(fields.rating)} is not good, usable or poor`);
  const listed = Array.isArray(fields.mechanisms) ? fields.mechanisms : null;
  const shown: Shown[] = [];
  if (listed === null) problems.push('no mechanisms array');
  else if (listed.length !== mechanisms) {
    problems.push(`${String(listed.length)} mechanisms judged, not ${String(mechanisms)}`);
  } else {
    for (const [index, entry] of listed.entries()) {
      const verdict = (entry as Record<string, unknown> | null)?.shown;
      if (typeof verdict === 'string' && (SHOWN as readonly string[]).includes(verdict)) {
        shown.push(verdict as Shown);
      } else problems.push(`mechanisms[${String(index)}] is not yes, partly or no`);
    }
  }
  if (problems.length > 0 || !answer || !reason || !rating.success) {
    return { judgement: null, problems };
  }
  return { judgement: { answer, mechanisms: shown, rating: rating.data, reason }, problems };
}

export interface JudgeOptions {
  folder: string;
  /** The sweep's overviews, from `overviews` over its scores. */
  work: readonly Overview[];
  judges: string[];
  /** Queries in flight at once; each is its own SDK subprocess. */
  parallel: number;
}

export interface JudgeDeps {
  query?: SdkQueryFn;
  onJudged?: (judge: string, branch: string, sample: number, meta: JudgeMeta) => void;
}

export function judgeFolder(sweep: string): string {
  return path.join(sweep, 'judgements');
}

export function judgementFiles(sweep: string, judge: string, branch: string, sample: number) {
  const folder = path.join(judgeFolder(sweep), judge, branch);
  return {
    folder,
    text: path.join(folder, `sample-${String(sample)}.txt`),
    meta: path.join(folder, `sample-${String(sample)}.json`),
  };
}

export interface Overview {
  branch: string;
  spec: DiagramBranchSpec;
  sample: number;
  diagram: Diagram;
}

/** Each scored sample's overview, where it drew one. */
export function overviews(scores: readonly BranchScore[]): Overview[] {
  return scores.flatMap((score) =>
    score.samples.flatMap((sample) => {
      const overview = sample.review?.diagrams.find((stats) => stats.where === 'overview');
      return overview
        ? [
            {
              branch: score.name,
              spec: score.spec,
              sample: sample.sample,
              diagram: overview.diagram,
            },
          ]
        : [];
    }),
  );
}

/** Judges every overview of a sweep, replacing whatever the sweep's judgements held. */
export async function runJudge(options: JudgeOptions, deps: JudgeDeps = {}): Promise<JudgeRecord> {
  for (const judge of options.judges) {
    if (!/^[\w.-]+$/.test(judge)) throw new Error(`a judge is a model name, not "${judge}"`);
  }
  const query = deps.query ?? (await loadQuery());
  const folder = judgeFolder(options.folder);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const record: JudgeRecord = {
    judges: options.judges,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    costUsd: null,
  };
  const recordFile = path.join(folder, 'judgements.json');
  await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);

  const jobs = options.judges.flatMap((judge) => options.work.map((item) => ({ judge, ...item })));
  const metas = await mapLimit(jobs, options.parallel, async (job) => {
    const files = judgementFiles(options.folder, job.judge, job.branch, job.sample);
    await mkdir(files.folder, { recursive: true });
    const started = performance.now();
    const outcome = await runSdkLoop(query, {
      prompt: buildJudgePrompt(job.spec, job.diagram),
      options: {
        cwd: files.folder,
        model: job.judge,
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        tools: [],
        allowedTools: [],
        maxTurns: 1,
        settingSources: [],
        env: agentEnv(),
        persistSession: false,
      },
    });
    if (outcome.sdkError) throw outcome.sdkError;
    const meta: JudgeMeta = {
      ms: Math.round(performance.now() - started),
      costUsd: outcome.result?.costUsd ?? null,
      ended: howItEnded(outcome.result),
    };
    await Promise.all([
      writeFile(files.text, outcome.raw),
      writeFile(files.meta, `${JSON.stringify(meta, null, 2)}\n`),
    ]);
    deps.onJudged?.(job.judge, job.branch, job.sample, meta);
    return meta;
  });

  record.finishedAt = new Date().toISOString();
  record.costUsd = metas.reduce<number | null>(
    (sum, meta) => (sum === null || meta.costUsd === null ? null : sum + meta.costUsd),
    0,
  );
  await writeFile(recordFile, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** One judge's verdict on one overview, keyed as the sheet and the agreement key it. */
export interface JudgedOverview {
  judge: string;
  branch: string;
  sample: number;
  parsed: ParsedJudgement;
}

/** Every judgement a sweep holds; empty when it was never judged. */
export async function readJudgements(
  sweep: string,
  scores: readonly BranchScore[],
): Promise<JudgedOverview[]> {
  let record: JudgeRecord;
  try {
    record = JudgeRecordSchema.parse(
      JSON.parse(await readFile(path.join(judgeFolder(sweep), 'judgements.json'), 'utf8')),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (record.finishedAt === null) {
    throw new Error(`${judgeFolder(sweep)} holds a judging that never finished; judge again`);
  }
  const judged: JudgedOverview[] = [];
  for (const judge of record.judges) {
    for (const item of overviews(scores)) {
      const files = judgementFiles(sweep, judge, item.branch, item.sample);
      const parsed = parseJudgement(
        await readFile(files.text, 'utf8'),
        item.spec.expect.mustName.length,
      );
      judged.push({ judge, branch: item.branch, sample: item.sample, parsed });
    }
  }
  return judged;
}

/** Each judge's ratings of one branch's overviews, or of every branch's, one line a judge. */
export function formatJudged(branch: string | null, judged: readonly JudgedOverview[]): string[] {
  const judges = [...new Set(judged.map((item) => item.judge))];
  return judges.map((judge) => {
    const mine = judged.filter(
      (item) => item.judge === judge && (branch === null || item.branch === branch),
    );
    const count = (rating: Rating) =>
      mine.filter((item) => item.parsed.judgement?.rating === rating).length;
    const unread = mine.filter((item) => item.parsed.judgement === null).length;
    const shown = mine.flatMap((item) => item.parsed.judgement?.mechanisms ?? []);
    const share = (verdict: Shown) =>
      `${String(Math.round((100 * shown.filter((item) => item === verdict).length) / shown.length))}%`;
    return (
      `judged by ${judge}: ${RATINGS.map((rating) => `${rating} ${String(count(rating))}`).join('  ·  ')}` +
      (unread > 0 ? `  ·  unreadable ${String(unread)}` : '') +
      (shown.length > 0
        ? `  ·  mechanisms ${SHOWN.map((verdict) => `${verdict} ${share(verdict)}`).join(' ')}`
        : '')
    );
  });
}

async function loadQuery(): Promise<SdkQueryFn> {
  // Loaded only by a real judging, as the run stage does: the SDK starts a
  // subprocess and weighs tens of megabytes, and scoring needs neither.
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk.query;
}
