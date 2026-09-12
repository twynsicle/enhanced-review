import { performance } from 'node:perf_hooks';
import type { NarrativeReview } from '../domain/review/narrative.ts';
import type { ReviewMeta } from '../domain/review/review-meta.ts';
import { type ClaudeRunDeps, type ClaudeRunResult, runClaude } from './claude-run.ts';
import { gather, readContext, type RunContext } from './context.ts';
import { Shell } from './git.ts';
import { onInterrupt } from './interrupts.ts';
import { parseRun, readReview } from './parse.ts';
import { openFile } from './platform.ts';
import { startProgress } from './progress.ts';
import { writePrompt } from './prompt.ts';
import { HOST_RENDER_DEPS, renderRun, type RenderDeps } from './render.ts';
import { createRunFolder, latestRunFolder, type RunFiles } from './run-folder.ts';
import { writeStubRun } from './stub-run.ts';
import { locateTarget, resolveTarget, type Target, type TargetRequest } from './targets.ts';
import { note, stage, warn } from './terminal.ts';
import {
  addWorktree,
  removeWorktree,
  removeWorktreeSync,
  sweepStaleWorktrees,
  type Worktree,
} from './worktree.ts';

/**
 * `er review`: resolve the target, then run the stages in order
 * (docs/local-mode D10), each printing one line when it finishes. `--from`
 * picks up the newest run folder for the same target and starts at a later
 * stage, reading what the earlier ones left on disk.
 */
export const STAGES = ['gather', 'prompt', 'run', 'parse', 'render'] as const;
export type Stage = (typeof STAGES)[number];
/** Gather starts a run, so it is not a place to resume from. */
export const RESUMABLE_STAGES = STAGES.slice(1) as Exclude<Stage, 'gather'>[];

export interface ReviewOptions {
  request: TargetRequest;
  /** Where `er` was run: anywhere inside the repository under review. */
  cwd: string;
  /** Write a mechanical review instead of running a model. */
  stub: boolean;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  from: Exclude<Stage, 'gather'> | null;
  /** Open the report when it is written. */
  open: boolean;
  /** Leave a PR review's worktree in place after the run. */
  keepWorktree: boolean;
}

export interface ReviewDeps {
  shell: Shell;
  render: RenderDeps;
  open: (file: string) => void;
  claude: ClaudeRunDeps;
}

export async function review(
  options: ReviewOptions,
  deps: ReviewDeps = {
    shell: new Shell(options.cwd),
    render: HOST_RENDER_DEPS,
    open: openFile,
    claude: {},
  },
): Promise<number> {
  const runs = (name: Stage) => STAGES.indexOf(name) >= STAGES.indexOf(options.from ?? 'gather');

  const { run, context } = options.from
    ? await resume(options.request, options.from, deps.shell)
    : await startRun(options.request, deps.shell);

  if (runs('prompt')) {
    const started = performance.now();
    const prompt = await writePrompt(context, run);
    stage(
      'prompt',
      `~${tokens(prompt)} tokens, plus the instructions`,
      performance.now() - started,
    );
  }

  if (runs('run')) {
    const started = performance.now();
    const repo = deps.shell.at(context.target.repoRoot);
    const swept = await sweepStaleWorktrees(repo);
    if (swept.length > 0)
      note(`  removed ${plural(swept.length, 'worktree')} left by an earlier run`);
    const worktree = await workingDirectory(context, repo, options.keepWorktree);
    const where = worktree ? ', in a worktree of the PR' : '';
    try {
      if (options.stub) {
        const chapters = await writeStubRun(context, run);
        stage(
          'run',
          `stub review, ${plural(chapters, 'chapter')}${where}`,
          performance.now() - started,
        );
      } else {
        const progress = startProgress();
        let result;
        try {
          result = await runClaude(
            run,
            {
              cwd: worktree?.path ?? context.target.repoRoot,
              model: options.model,
              maxTurns: options.maxTurns,
              timeoutMs: options.timeoutMs,
            },
            {
              onActivity: progress.activity,
              onText: progress.text,
              ...deps.claude,
            },
          );
        } finally {
          progress.stop();
        }
        if (result.incomplete !== null) warn(incompleteWarning(result));
        stage('run', `${describeRun(result)}${where}`, performance.now() - started);
        // A refusal costs the model a turn, so it is worth knowing about even
        // though the review still finished: the gate may be too tight.
        if (result.denied > 0) {
          note(`  ${plural(result.denied, 'command')} refused; see ${run.events}`);
        }
      }
    } finally {
      await worktree?.close();
    }
  }

  let parsed: NarrativeReview;
  if (runs('parse')) {
    const started = performance.now();
    parsed = await parseRun(context, run);
    const cited = parsed.chapters.flatMap((c) => c.diffChunks.flatMap((d) => d.hunks)).length;
    stage(
      'parse',
      `${plural(parsed.chapters.length, 'chapter')}, ${plural(cited, 'hunk')} cited`,
      performance.now() - started,
    );
  } else {
    parsed = await readReview(run);
  }

  const started = performance.now();
  const bytes = await renderRun(context, parsed, run, deps.render);
  stage('render', `review.html, ${megabytes(bytes)}`, performance.now() - started);
  note(`  ${run.html}`);
  if (options.open) deps.open(run.html);
  return 0;
}

/**
 * The agent's working directory: for a PR, a worktree of its head, removed
 * when the run ends or is interrupted; otherwise the repository itself.
 */
async function workingDirectory(
  context: RunContext,
  repo: Shell,
  keep: boolean,
): Promise<{ path: string; close: () => Promise<void> } | null> {
  if (context.target.kind !== 'pr') return null;
  const worktree: Worktree = await addWorktree(
    repo,
    context.meta.prNumber ?? 0,
    context.target.headSha,
    new Date(),
  );
  const unregister = keep ? () => undefined : onInterrupt(() => removeWorktreeSync(worktree));
  return {
    path: worktree.path,
    close: async () => {
      unregister();
      if (keep) {
        note(`  kept the worktree at ${worktree.path}; the next PR run removes it`);
      } else {
        await removeWorktree(repo, worktree);
      }
    },
  };
}

async function startRun(
  request: TargetRequest,
  shell: Shell,
): Promise<{ run: RunFiles; context: RunContext }> {
  let started = performance.now();
  const { target, meta } = await resolveTarget(request, shell, { warn });
  stage('target', describeTarget(target, meta), performance.now() - started);

  started = performance.now();
  const run = await createRunFolder(target.repoRoot, target.slug, new Date());
  const context = await gather(target, meta, shell.at(target.repoRoot), run);
  if (context.dirty.length > 0) warn(dirtyWarning(context));
  stage('gather', describeGather(context), performance.now() - started);
  return { run, context };
}

async function resume(
  request: TargetRequest,
  from: Stage,
  shell: Shell,
): Promise<{ run: RunFiles; context: RunContext }> {
  const { repoRoot, slug } = await locateTarget(request, shell);
  const run = await latestRunFolder(repoRoot, slug);
  if (!run) throw new Error(`no earlier run for ${slug} to resume; run without --from first`);
  note(`  from ${from}, in ${run.folder}`);
  return { run, context: await readContext(run) };
}

export function describeTarget(target: Target, meta: ReviewMeta): string {
  const range = `${target.baseSha.slice(0, 7)}..${target.headSha.slice(0, 7)}`;
  const what =
    meta.prNumber === null
      ? `${target.headLabel} against ${target.baseLabel}`
      : `PR #${String(meta.prNumber)} ${meta.title}, against ${target.baseLabel}`;
  return `${meta.repo} ${what} (${range})`;
}

/** What the model cost and how hard it worked, for the stage line. */
function describeRun(result: ClaudeRunResult): string {
  const cost = result.costUsd === null ? '' : `, $${result.costUsd.toFixed(2)}`;
  return `${plural(result.turns, 'turn')}, ~${approxTokens(result.characters)} tokens of review${cost}${describeUsage(result.usage)}`;
}

/**
 * An agentic run pays for its context on every turn, so what it cost is
 * mostly a question of how much of that context was read from cache rather
 * than sent again. The share is the one number that explains the bill.
 */
function describeUsage(usage: ClaudeRunResult['usage']): string {
  if (usage === null) return '';
  const sent = usage.inputTokens + usage.cacheWriteTokens;
  const total = sent + usage.cacheReadTokens;
  if (total === 0) return '';
  const cached = Math.round((usage.cacheReadTokens / total) * 100);
  return ` (${approxCount(total)} tokens in, ${String(cached)}% cached)`;
}

function incompleteWarning(result: ClaudeRunResult): string {
  return (
    `the model stopped early (${result.incomplete ?? 'unknown'}); the review may be partial. ` +
    'Raise --max-turns, or edit raw.txt and use --from parse.'
  );
}

function describeGather(context: RunContext): string {
  const skipped = context.files.filter((file) => file.skipped).length;
  const files = plural(context.files.length, 'file');
  return `${files}${skipped > 0 ? ` (${String(skipped)} skipped)` : ''}, ${plural(context.hunks.length, 'hunk')}`;
}

function dirtyWarning(context: RunContext): string {
  const { dirty, target } = context;
  const kind = target.kind === 'staged' ? 'unstaged or untracked' : 'uncommitted';
  const shown = dirty.slice(0, 3).join(', ');
  const more = dirty.length > 3 ? `, +${String(dirty.length - 3)} more` : '';
  return (
    `${plural(dirty.length, `${kind} change`)} not in this review, ` +
    `though the agent can see them on disk: ${shown}${more}`
  );
}

/** A rough count at four characters a token, the hosted prompt's own estimate. */
function tokens(text: string): string {
  return approxTokens(text.length);
}

function approxTokens(characters: number): string {
  return approxCount(Math.round(characters / 4));
}

/** A whole run's input runs to millions, so this counts that high. */
function approxCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
