import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { z } from 'zod';
import { mapLimit } from '../cli/git-runner.ts';
import { hostEnv } from '../cli/host-env.ts';
import { WARNED } from '../cli/review.ts';
import { latestRunFolder, runStamp } from '../cli/run-folder.ts';
import { slugify } from '../cli/targets.ts';
import { DiagramStyleSchema, type DiagramStyle } from '../review/prompt/diagram-styles.ts';
import { withContrivedBranch } from './contrive.ts';
import {
  branchDigest,
  DIAGRAM_CONTRIVED_DIR,
  DIAGRAM_RESULTS_DIR,
  packhouseRepo,
  readDiagramSpec,
} from './diagram-case.ts';

/**
 * One diagram sweep: every branch, `samples` times each, each sample a whole
 * `er review` on the branch stood up afresh, since whether a diagram is drawn
 * at all is decided while the model chapters the change. The run folder is
 * copied out before the throwaway repository goes, and the sweep is scored
 * afterwards from what it kept, so an edited expectation rescores the
 * samples already paid for.
 *
 *   evals/diagrams/results/<stamp>/
 *     run.json                   model, diagram style, samples, branches and their digests, cost
 *     <branch>/sample-<n>.json   how er exited, what the run cost, why it failed
 *     <branch>/sample-<n>/       the run folder: review.json, findings.json, review.html, …
 */
export const DiagramSweepSchema = z.object({
  /** null for er's default, so a sweep measures what a reviewer gets. */
  model: z.string().nullable(),
  /** Passed to every review, so two sweeps of the same code can compare the styles. */
  diagramStyle: DiagramStyleSchema,
  samples: z.number().int().positive(),
  branches: z.array(z.string()),
  /** Each branch's digest when it was swept; a score of a branch changed since is refused. */
  digests: z.record(z.string(), z.string()),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
});
export type DiagramSweep = z.infer<typeof DiagramSweepSchema>;

export const DiagramSampleSchema = z.object({
  exitCode: z.number().int(),
  ms: z.number(),
  costUsd: z.number().nullable(),
  turns: z.number().nullable(),
  /** The tail of er's output when it wrote no review; null when it did. */
  failure: z.string().nullable(),
});
export type DiagramSample = z.infer<typeof DiagramSampleSchema>;

export interface DiagramSweepOptions {
  root: string;
  model: string | null;
  diagramStyle: DiagramStyle;
  samples: number;
  branches: string[];
  /** Reviews in flight at once; each is its own er process and model run. */
  parallel: number;
}

export interface ReviewOutcome {
  exitCode: number;
  output: string;
}

/** What every review of a sweep is asked for. */
export interface ReviewRun {
  model: string | null;
  diagramStyle: DiagramStyle;
}

export interface DiagramSweepDeps {
  /** Runs `er review --no-open` in a stood-up branch; the real one spawns this checkout's bin. */
  review?: (cwd: string, run: ReviewRun) => Promise<ReviewOutcome>;
  onSample?: (branch: string, sample: number, meta: DiagramSample) => void;
}

export function diagramSweepFile(folder: string): string {
  return path.join(folder, 'run.json');
}

export function diagramSampleFiles(folder: string, branch: string, sample: number) {
  return {
    meta: path.join(folder, branch, `sample-${String(sample)}.json`),
    run: path.join(folder, branch, `sample-${String(sample)}`),
  };
}

export async function runDiagramSweep(
  options: DiagramSweepOptions,
  deps: DiagramSweepDeps = {},
): Promise<string> {
  const review = deps.review ?? erReview;
  const folder = path.join(options.root, DIAGRAM_RESULTS_DIR, runStamp(new Date()));
  await mkdir(folder, { recursive: true });
  const digests = await Promise.all(
    options.branches.map(async (name) => [name, await branchDigest(options.root, name)] as const),
  );
  const record: DiagramSweep = {
    model: options.model,
    diagramStyle: options.diagramStyle,
    samples: options.samples,
    branches: options.branches,
    digests: Object.fromEntries(digests),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    costUsd: null,
  };
  await writeFile(diagramSweepFile(folder), `${JSON.stringify(record, null, 2)}\n`);

  const jobs = options.branches.flatMap((name) =>
    Array.from({ length: options.samples }, (_, index) => ({ name, sample: index + 1 })),
  );
  const metas = await mapLimit(jobs, options.parallel, async ({ name, sample }) => {
    const files = diagramSampleFiles(folder, name, sample);
    const meta = await runSample(options, name, files, review);
    deps.onSample?.(name, sample, meta);
    return meta;
  });

  record.finishedAt = new Date().toISOString();
  record.costUsd = metas.reduce((sum, meta) => sum + (meta.costUsd ?? 0), 0);
  await writeFile(diagramSweepFile(folder), `${JSON.stringify(record, null, 2)}\n`);
  return folder;
}

async function runSample(
  options: DiagramSweepOptions,
  name: string,
  files: ReturnType<typeof diagramSampleFiles>,
  review: NonNullable<DiagramSweepDeps['review']>,
): Promise<DiagramSample> {
  const specDir = path.join(options.root, DIAGRAM_CONTRIVED_DIR, name);
  const spec = await readDiagramSpec(specDir);
  const repo = packhouseRepo(options.root);
  const meta = await withContrivedBranch(repo, specDir, spec, async (work) => {
    const started = performance.now();
    const outcome = await review(work, {
      model: options.model,
      diagramStyle: options.diagramStyle,
    });
    const ms = Math.round(performance.now() - started);
    const run = await latestRunFolder(work, `branch-${slugify(spec.branch)}`);
    if (run) await cp(run.folder, files.run, { recursive: true });
    const result = run ? await runResult(run.events) : null;
    const wrote = run !== null && (outcome.exitCode === 0 || outcome.exitCode === WARNED);
    const sample: DiagramSample = {
      exitCode: outcome.exitCode,
      ms,
      costUsd: result?.costUsd ?? null,
      turns: result?.turns ?? null,
      failure: wrote ? null : tail(outcome.output) || `er exited ${String(outcome.exitCode)}`,
    };
    return sample;
  });
  await mkdir(path.dirname(files.meta), { recursive: true });
  await writeFile(files.meta, `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

const ResultEventSchema = z.object({
  type: z.literal('result'),
  costUsd: z.number().nullable().optional(),
  turns: z.number().nullable().optional(),
});

/** The run stage's result event, or null when it logged none. */
async function runResult(
  events: string,
): Promise<{ costUsd: number | null; turns: number | null } | null> {
  let log: string;
  try {
    log = await readFile(events, 'utf8');
  } catch {
    return null;
  }
  for (const text of log.split('\n').toReversed()) {
    if (!text.trim()) continue;
    const parsed = ResultEventSchema.safeParse(JSON.parse(text));
    if (parsed.success) {
      return { costUsd: parsed.data.costUsd ?? null, turns: parsed.data.turns ?? null };
    }
  }
  return null;
}

function tail(output: string): string {
  return output.trim().split('\n').slice(-20).join('\n');
}

const execFileAsync = promisify(execFile);

/**
 * `er review --no-open` through this checkout's bin. The exit code is
 * returned rather than thrown: a warning exit still wrote the report, and a
 * first answer disqualified and then fixed is a result, not a lost sample.
 */
async function erReview(cwd: string, run: ReviewRun): Promise<ReviewOutcome> {
  const bin = path.join(path.dirname(import.meta.dirname), 'cli', 'er.ts');
  const args = [
    bin,
    'review',
    '--no-open',
    '--diagram-style',
    run.diagramStyle,
    ...(run.model ? ['--model', run.model] : []),
  ];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd,
      env: hostEnv(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const { code, stdout, stderr } = error as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof code !== 'number') throw error;
    return { exitCode: code, output: `${stdout ?? ''}${stderr ?? ''}` };
  }
}

export async function readDiagramSweep(folder: string): Promise<DiagramSweep> {
  const file = diagramSweepFile(folder);
  const parsed = DiagramSweepSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file} is not a diagram sweep: ${parsed.error.message}`);
  return parsed.data;
}

export async function readDiagramSample(file: string): Promise<DiagramSample> {
  const parsed = DiagramSampleSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file} is not a diagram sample: ${parsed.error.message}`);
  return parsed.data;
}
