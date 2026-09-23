import { rename } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { plural } from '../review/plural.ts';
import { reviewCoverage } from '../review/coverage.ts';
import { MAX_VALIDATION_RETRIES } from './validation-stop-hook.ts';
import type { Finding } from '../review/findings.ts';
import type { NarrativeReview } from '../review/narrative.ts';
import type { ReviewMeta } from '../review/review-meta.ts';
import { type ClaudeRunDeps, type ClaudeRunResult, runClaude } from './claude-run.ts';
import { gather, readContext, type RunContext } from './context.ts';
import { Shell } from './git.ts';
import { onInterrupt } from './interrupts.ts';
import { groundingForRun, parseRun, readFindings, readReview } from './parse.ts';
import { openFile } from './platform.ts';
import { startProgress } from './progress.ts';
import { writePrompt } from './prompt.ts';
import { HOST_RENDER_DEPS, renderRun, type RenderDeps } from './render.ts';
import { createRunFolder, latestRunFolder, reportFileName, type RunFiles } from './run-folder.ts';
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
 * `er review`: resolve the target, then run the stages in order, each
 * printing one line when it finishes. `--from` picks up the newest run folder
 * for the same target and starts at a later stage, reading what the earlier
 * ones left on disk.
 *
 * The exit code says what the review is worth: 0 clean, `WARNED` when it
 * shipped with warnings — something around the chapters was lost, and whoever
 * ran it has been told what — and 1 when there is no review at all. A script
 * that treats anything non-zero as failure therefore stops on a review it
 * should still read, which is the right way round: the two can be told apart
 * by anyone who cares to, and are conflated safely by anyone who does not.
 */
export const STAGES = ['gather', 'prompt', 'run', 'parse', 'render'] as const;
export type Stage = (typeof STAGES)[number];
/** Gather starts a run, so it is not a place to resume from. */
export const RESUMABLE_STAGES = STAGES.slice(1) as Exclude<Stage, 'gather'>[];

/** The exit code for a review that was written but carries warnings. */
export const WARNED = 2;

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
  /** Run the model on a change past `REFUSE_REVIEWED_FILES`. */
  allowLarge: boolean;
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
    : await startRun(options.request, deps.shell, !options.stub && !options.allowLarge);

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
    if (!options.stub && !options.allowLarge) checkSize(context);
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
              grounding: groundingForRun(context),
            },
            {
              onActivity: progress.activity,
              onText: progress.text,
              onBlocked: blockedNote,
              onHookError: hookErrorNote,
              ...deps.claude,
            },
          );
        } finally {
          // The heartbeat outlives the run otherwise, and would go on saying
          // the model is working over the parse and render lines.
          progress.stop();
        }
        stage('run', `${describeRun(result)}${where}`, performance.now() - started);
      }
    } finally {
      await worktree?.close();
    }
  }

  let parsed: NarrativeReview;
  let findings: Finding[];
  if (runs('parse')) {
    const started = performance.now();
    const result = await parseRun(context, run);
    parsed = result.review;
    findings = result.findings;
    stage(
      'parse',
      `${plural(parsed.chapters.length, 'chapter')}, ${plural(reviewCoverage(parsed).total, 'hunk')}`,
      performance.now() - started,
    );
  } else {
    // Rendering again is still shipping the review, so it still says what the
    // review cost. The answer is not in front of this stage; what the parse
    // made of it is, in findings.json.
    parsed = await readReview(run);
    findings = await readFindings(run);
  }
  // The review still ships: each of these is something around the chapters
  // that was lost, not a hole in them. Said before the report opens, because
  // afterwards nobody comes back to the terminal.
  const warnings = findings.filter((item) => item.severity === 'warning');
  for (const warning of warnings) warn(warning.message);

  const started = performance.now();
  const bytes = await renderRun(context, parsed, run, deps.render);
  const reportPath = path.join(path.dirname(run.html), reportFileName(context.meta));
  if (reportPath !== run.html) await rename(run.html, reportPath);
  stage('render', `${path.basename(reportPath)}, ${megabytes(bytes)}`, performance.now() - started);
  note(`  ${reportPath}`);
  if (options.open) deps.open(reportPath);
  return warnings.length > 0 ? WARNED : 0;
}

/**
 * A model run grows with the change, in time and in tokens, and a change far
 * past a normal review is more often a wrong base than a real change: a
 * stacked branch whose base was rebased where no reflog shows the fork, or a
 * `--base` that is simply wrong. Counted over the files the model is actually
 * given. A fresh run is refused inside gather, before it reads every blob of
 * a change that may be thousands of files; a resumed one just before the run.
 * A `--stub` run costs nothing and is held to neither.
 */
export const WARN_REVIEWED_FILES = 50;
export const REFUSE_REVIEWED_FILES = 300;

function refuseTooLarge(count: number, target: Target, gathered: boolean): void {
  if (count <= REFUSE_REVIEWED_FILES) return;
  const keep = gathered ? ' (and --from run to keep this gather)' : '';
  throw new Error(
    `${plural(count, 'file')} to review, past the ${String(REFUSE_REVIEWED_FILES)} a model run ` +
      `is allowed${wrongBaseHint(target)}; if the change really is this big, run again with ` +
      `--allow-large${keep}`,
  );
}

function checkSize(context: RunContext): void {
  const count = context.files.filter((file) => !file.skipped).length;
  refuseTooLarge(count, context.target, true);
  if (count > WARN_REVIEWED_FILES) {
    warn(
      `${plural(count, 'file')} to review, more than a typical change${wrongBaseHint(context.target)}`,
    );
  }
}

function wrongBaseHint({ kind, baseLabel }: Target): string {
  if (kind === 'staged') return '';
  return (
    `; if ${baseLabel} is not where this change starts (a stacked branch whose base was ` +
    'rebased, say), pass --base <ref>'
  );
}

/**
 * A disqualified answer, as it happens. Only what was wrong with it: the rest
 * of what the model was sent is an instruction addressed to the model, and it
 * is in `events.jsonl` for anyone who wants it.
 */
function blockedNote(attempt: number, defects: string): void {
  note(
    `  answer disqualified, asking again (${String(attempt)} of ${String(MAX_VALIDATION_RETRIES)}): ${defects}`,
  );
}

/** The run carried on ungraded; whatever it wrote is judged at the parse stage. */
function hookErrorNote(error: Error): void {
  warn(`the answer could not be checked while the model was still writing: ${error.message}`);
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
  limitSize: boolean,
): Promise<{ run: RunFiles; context: RunContext }> {
  let started = performance.now();
  const { target, meta } = await resolveTarget(request, shell, { warn });
  stage('target', describeTarget(target, meta), performance.now() - started);

  started = performance.now();
  const run = await createRunFolder(target.repoRoot, target.slug, new Date());
  const context = await gather(target, meta, shell.at(target.repoRoot), run, (count) => {
    if (limitSize) refuseTooLarge(count, target, false);
  });
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

/**
 * What the model cost and how hard it worked, for the stage line. A run that
 * did not end cleanly says so here and nothing more: the parse stage is where
 * that becomes the finding which fails the review.
 */
function describeRun(result: ClaudeRunResult): string {
  const cost = result.costUsd === null ? '' : `, $${result.costUsd.toFixed(2)}`;
  const ended = result.incomplete === null ? '' : `, ended ${result.incomplete}`;
  return `${plural(result.turns, 'turn')}, ~${approxTokens(result.characters)} tokens of review${cost}${describeUsage(result.usage)}${ended}`;
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

/** A rough count at four characters a token. */
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
