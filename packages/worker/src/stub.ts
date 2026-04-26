import type { SupabaseClient } from '@supabase/supabase-js';

import { StubExecutor } from './executor/stub-executor';
import type { ReviewExecutor } from './executor/types';
import {
  StreamCapExceededError,
  createChunkBatcher,
  type ChunkBatcher,
} from './streaming/chunk-batcher';
import type { ClaimedJob } from './types';
import { finalizeAsDone, markErrored } from './writes';

/**
 * Phase 5+ stub job: drives a {@link StubExecutor} through the same
 * batcher → review_chunks pipeline that the real opencode executor
 * uses. That way `REVIEW_EXECUTOR=stub` exercises the streaming code
 * path during dev, and streaming-related regressions surface in the
 * stub tests rather than only under live opencode.
 *
 * The previous (Phase 3) version polled `review_jobs.status` between
 * chunk emits to detect cancellation. With session.ts now wiring an
 * `AbortSignal` from the cancel NOTIFY, the stub follows the same
 * convention: cancellation is signal-driven, not DB-polled.
 */

export interface RunStubJobDeps {
  supabase: SupabaseClient;
  /** Test seam: substitute the StubExecutor with another fake. */
  executor?: ReviewExecutor;
  /** Test seam: substitute the chunk batcher. */
  createBatcher?: (jobId: string) => ChunkBatcher;
}

export type StubJobOutcome = 'done' | 'cancelled' | 'errored';

export async function runStubJob(
  deps: RunStubJobDeps,
  job: ClaimedJob,
  signal: AbortSignal,
): Promise<StubJobOutcome> {
  const executor = deps.executor ?? new StubExecutor();
  const createBatcher =
    deps.createBatcher ??
    ((jobId: string) => createChunkBatcher({ supabase: deps.supabase, jobId }));

  let batcher: ChunkBatcher | null = null;
  try {
    batcher = createBatcher(job.id);
    const result = await executor.run({
      cloneDir: '/tmp/stub',
      prData: {
        title: 'stub',
        body: '',
        author: 'stub',
        baseRefName: 'main',
        headRefName: 'stub',
        files: [],
        diff: '',
      },
      filteredDiff: '',
      target: { kind: 'branch', owner: 'stub', repo: 'stub', ref: 'stub', baseRef: 'main', baseSha: '0' },
      signal,
      model: 'stub',
      onChunk: batcher.onChunk,
    });

    if (signal.aborted) {
      return 'cancelled';
    }

    await batcher.flush();
    await finalizeAsDone(deps.supabase, job.id, result.review, {
      diffTruncated: result.wasTruncated,
    });
    return 'done';
  } catch (err) {
    if (signal.aborted) {
      return 'cancelled';
    }
    await markErrored(deps.supabase, job.id, formatStubError(err));
    return 'errored';
  } finally {
    if (batcher !== null) {
      try {
        await batcher.flush();
      } catch {
        /* swallowed: tail flush after error/cancel is best-effort */
      }
    }
  }
}

function formatStubError(err: unknown): string {
  if (err instanceof StreamCapExceededError) {
    return 'stream cap exceeded';
  }
  return err instanceof Error ? err.message : String(err);
}
