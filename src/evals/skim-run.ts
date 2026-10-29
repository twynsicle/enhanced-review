import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { mapLimit } from '../cli/git-runner.ts';
import { agentEnv, hostEnv } from '../cli/host-env.ts';
import { runStamp } from '../cli/run-folder.ts';
import { howItEnded, runSdkLoop, type SdkQueryFn, type SdkUsage } from '../cli/sdk-loop.ts';
import { parseTierAnswer, type ParsedAnswer } from './skim-answer.ts';
import { caseFiles, catalogDigest, readCase, RESULTS_DIR, type LoadedCase } from './skim-case.ts';
import { buildSkimPrompt, SKIM_SYSTEM_PROMPT } from './skim-prompt.ts';

/**
 * One sweep: every case, `samples` times each, one SDK query per sample with
 * no tools and one turn, the answer written as it came. The sweep is scored
 * afterwards from what it wrote, so relabelling a case rescores the samples
 * already paid for.
 *
 *   evals/skims/results/<stamp>/
 *     run.json                 model, samples, cases, what it cost
 *     <case>/sample-<n>.txt    the model's answer
 *     <case>/sample-<n>.json   how that sample ended and what it cost
 */
export const SweepSchema = z.object({
  model: z.string(),
  samples: z.number().int().positive(),
  cases: z.array(z.string()),
  /** Each case's catalogDigest when it was swept, so a recut case is not scored against old answers. */
  catalogs: z.record(z.string(), z.string()),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
});
export type Sweep = z.infer<typeof SweepSchema>;

export const SampleMetaSchema = z.object({
  ms: z.number(),
  costUsd: z.number().nullable(),
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
    })
    .nullable(),
  /** How the run ended when not cleanly; null for a finished answer. */
  ended: z.string().nullable(),
});
export type SampleMeta = z.infer<typeof SampleMetaSchema>;

export interface SweepOptions {
  root: string;
  model: string;
  samples: number;
  cases: string[];
  /** Queries in flight at once; each is its own SDK subprocess. */
  parallel: number;
}

export interface SweepDeps {
  query?: SdkQueryFn;
  onSample?: (caseName: string, sample: number, meta: SampleMeta) => void;
}

export interface SweepFiles {
  folder: string;
  run: string;
}

export function sweepFiles(folder: string): SweepFiles {
  return { folder, run: path.join(folder, 'run.json') };
}

export function sampleFiles(sweep: SweepFiles, caseName: string, sample: number) {
  const folder = path.join(sweep.folder, caseName);
  return {
    folder,
    text: path.join(folder, `sample-${String(sample)}.txt`),
    meta: path.join(folder, `sample-${String(sample)}.json`),
  };
}

/**
 * A sweep spends real money, many times over, so it insists on an API key:
 * a run signed in as the engineer would draw the whole sweep from their plan's
 * allowance, where one key from a Console organisation spends the credits a
 * Max plan includes for exactly this.
 */
export function requireApiKey(): void {
  const key = hostEnv().ANTHROPIC_API_KEY;
  if (typeof key === 'string' && key.trim() !== '') return;
  throw new Error(
    'ANTHROPIC_API_KEY is not set. The skim eval runs many samples and spends only API credit, ' +
      'never a plan sign-in: create a key in the Console organisation linked to your plan ' +
      '(platform.claude.com/settings/billing) and export it for this shell.',
  );
}

export async function runSweep(options: SweepOptions, deps: SweepDeps = {}): Promise<SweepFiles> {
  const query = deps.query ?? (await loadQuery());
  const loaded = new Map<string, LoadedCase>();
  for (const name of options.cases) loaded.set(name, await readCase(caseFiles(options.root, name)));

  const sweep = sweepFiles(path.join(options.root, RESULTS_DIR, runStamp(new Date())));
  await mkdir(sweep.folder, { recursive: true });
  const record: Sweep = {
    model: options.model,
    samples: options.samples,
    cases: options.cases,
    catalogs: Object.fromEntries(
      options.cases.map((name) => [name, catalogDigest(loaded.get(name)!.case)]),
    ),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    costUsd: null,
  };
  await writeFile(sweep.run, `${JSON.stringify(record, null, 2)}\n`);

  const jobs = options.cases.flatMap((name) =>
    Array.from({ length: options.samples }, (_, index) => ({ name, sample: index + 1 })),
  );
  const metas = await mapLimit(jobs, options.parallel, async ({ name, sample }) => {
    const files = sampleFiles(sweep, name, sample);
    await mkdir(files.folder, { recursive: true });
    const { case: skimCase, diff } = loaded.get(name)!;
    const meta = await runSample(query, options.model, buildSkimPrompt(skimCase, diff), files);
    deps.onSample?.(name, sample, meta);
    return meta;
  });

  record.finishedAt = new Date().toISOString();
  record.costUsd = metas.reduce<number | null>(
    (sum, meta) => (sum === null || meta.costUsd === null ? null : sum + meta.costUsd),
    0,
  );
  await writeFile(sweep.run, `${JSON.stringify(record, null, 2)}\n`);
  return sweep;
}

async function runSample(
  query: SdkQueryFn,
  model: string,
  prompt: string,
  files: ReturnType<typeof sampleFiles>,
): Promise<SampleMeta> {
  const started = performance.now();
  const outcome = await runSdkLoop(query, {
    prompt,
    options: {
      cwd: files.folder,
      model,
      systemPrompt: SKIM_SYSTEM_PROMPT,
      tools: [],
      allowedTools: [],
      maxTurns: 1,
      settingSources: [],
      env: agentEnv(),
      persistSession: false,
    },
  });
  if (outcome.sdkError) throw outcome.sdkError;
  const usage: SdkUsage | null = outcome.result?.usage ?? null;
  const meta: SampleMeta = {
    ms: Math.round(performance.now() - started),
    costUsd: outcome.result?.costUsd ?? null,
    usage,
    ended: howItEnded(outcome.result),
  };
  await Promise.all([
    writeFile(files.text, outcome.raw),
    writeFile(files.meta, `${JSON.stringify(meta, null, 2)}\n`),
  ]);
  return meta;
}

/** A sweep's record and each case's answers, read back for scoring. */
export async function readSweep(
  sweep: SweepFiles,
): Promise<{ record: Sweep; answers: Map<string, ParsedAnswer[]> }> {
  const parsed = SweepSchema.safeParse(JSON.parse(await readFile(sweep.run, 'utf8')));
  if (!parsed.success) throw new Error(`${sweep.run} is not a sweep: ${parsed.error.message}`);
  const record = parsed.data;
  const answers = new Map<string, ParsedAnswer[]>();
  for (const name of record.cases) {
    const list: ParsedAnswer[] = [];
    for (let sample = 1; sample <= record.samples; sample += 1) {
      const files = sampleFiles(sweep, name, sample);
      list.push(parseTierAnswer(await readFile(files.text, 'utf8')));
    }
    answers.set(name, list);
  }
  return { record, answers };
}

async function loadQuery(): Promise<SdkQueryFn> {
  // Loaded only by a real sweep, as the run stage does: the SDK starts a
  // subprocess and weighs tens of megabytes, and scoring needs neither.
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  return sdk.query;
}
