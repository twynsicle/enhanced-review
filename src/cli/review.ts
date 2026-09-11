import { performance } from 'node:perf_hooks';
import type { ReviewMeta } from '../domain/review/review-meta.ts';
import { Shell } from './git.ts';
import { resolveTarget, type Target, type TargetRequest } from './targets.ts';
import { stage, warn } from './terminal.ts';

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
  const started = performance.now();
  const { target, meta } = await resolveTarget(options.request, new Shell(options.cwd), { warn });
  stage('target', describeTarget(target, meta), performance.now() - started);
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
