import { performance } from 'node:perf_hooks';
import type { ReviewMeta } from '../domain/review/review-meta.ts';
import { gather, type RunContext } from './context.ts';
import { Shell } from './git.ts';
import { createRunFolder } from './run-folder.ts';
import { resolveTarget, type Target, type TargetRequest } from './targets.ts';
import { note, stage, warn } from './terminal.ts';

/**
 * `er review`: resolve the target, then run the stages in order
 * (docs/local-mode D10). Each stage prints one line when it finishes.
 */
export interface ReviewOptions {
  request: TargetRequest;
  /** Where `er` was run: anywhere inside the repository under review. */
  cwd: string;
}

export async function review(options: ReviewOptions): Promise<number> {
  let started = performance.now();
  const shell = new Shell(options.cwd);
  const { target, meta } = await resolveTarget(options.request, shell, { warn });
  stage('target', describeTarget(target, meta), performance.now() - started);

  started = performance.now();
  const run = await createRunFolder(target.repoRoot, target.slug, new Date());
  const context = await gather(target, meta, shell.at(target.repoRoot), run);
  if (context.dirty.length > 0) warn(dirtyWarning(context));
  stage('gather', describeGather(context), performance.now() - started);

  note(`  ${run.folder}`);
  return 0;
}

export function describeTarget(target: Target, meta: ReviewMeta): string {
  const range = `${target.baseSha.slice(0, 7)}..${target.headSha.slice(0, 7)}`;
  const what =
    meta.prNumber === null
      ? `${target.headLabel} against ${target.baseLabel}`
      : `PR #${String(meta.prNumber)} ${meta.title}, against ${target.baseLabel}`;
  return `${meta.repo} ${what} (${range})`;
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

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
