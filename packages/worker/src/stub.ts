import type { SupabaseClient } from '@supabase/supabase-js';
import type { NarrativeReview } from '@enhanced-review/review-types';
import { type Querier, selectStatus } from './db';
import { finalizeAsDone, insertChunk, markErrored } from './writes';
import type { ClaimedJob } from './types';

/**
 * The fake chunks the stub worker streams. Five lines, one second apart
 * by default — enough to make the Realtime subscription observable in
 * a demo without being annoying.
 */
export const STUB_CHUNKS: readonly string[] = [
  'Cloning repository at HEAD…',
  'Reading recent commits and PR metadata…',
  'Drafting Chapter 1 — high-level shape of the change…',
  'Drafting Chapter 2 — risks and follow-ups…',
  'Wrapping up review.',
];

/**
 * The hard-coded NarrativeReview the stub writes to `reviews.content`
 * once the chunks have streamed. Phase 4 replaces the producer; the
 * shape stays stable so Phase 6's reader UI can render either.
 */
export function buildStubReview(job: ClaimedJob): NarrativeReview {
  const target = job.target as { kind?: string; title?: string; ref?: string; number?: number };
  const title =
    target?.kind === 'pr' && target.title
      ? target.title
      : target?.kind === 'branch' && target.ref
        ? `Branch ${target.ref}`
        : 'Stub review';

  return {
    prTitle: title,
    overviewSummary:
      'This is a stub review produced by the Phase 3 worker. Real opencode-driven analysis arrives in Phase 4.',
    chapters: [
      {
        id: 'stub-chapter-1',
        title: 'Shape of the change',
        insights: [
          {
            type: 'context',
            text: 'The diff touches a handful of files; the stub worker did not actually read them.',
          },
          {
            type: 'highlight',
            text: 'Phase 4 will replace this placeholder with a real AI-generated narrative.',
          },
        ],
        diffChunks: [],
      },
      {
        id: 'stub-chapter-2',
        title: 'Risks and follow-ups',
        insights: [
          {
            type: 'rationale',
            text: 'No risk analysis is performed by the stub. Treat all PRs as low-risk for now.',
          },
        ],
        diffChunks: [],
      },
    ],
  };
}

export interface RunStubJobDeps {
  pg: Querier;
  supabase: SupabaseClient;
  /** Test seam: replace with a deterministic delay in unit tests. */
  sleep: (ms: number) => Promise<void>;
  /** Fake-chunk pause, in ms. */
  chunkDelayMs: number;
}

export type StubJobOutcome = 'done' | 'cancelled' | 'errored';

/**
 * Stream {@link STUB_CHUNKS} into `review_chunks` one second apart,
 * checking for cancellation between chunks. On the last chunk emitted
 * cleanly, write the {@link buildStubReview} payload and flip status
 * to `done`. On `cancelled`, exit without writing the reviews row.
 */
export async function runStubJob(deps: RunStubJobDeps, job: ClaimedJob): Promise<StubJobOutcome> {
  try {
    for (let i = 0; i < STUB_CHUNKS.length; i++) {
      // Check cancellation before each emit. Doing it before (not after)
      // means the worker stops as quickly as possible once the user
      // clicks Cancel; the trade-off is one extra round-trip per chunk.
      const status = await selectStatus(deps.pg, job.id);
      if (status === 'cancelled') return 'cancelled';
      if (status === null) return 'errored';

      await insertChunk(deps.supabase, job.id, i, STUB_CHUNKS[i]!);

      // Pause between chunks (and before the finalize) so the demo is
      // visibly streaming. No pause after the last chunk would lose the
      // visual cue; pause first then check status one more time.
      await deps.sleep(deps.chunkDelayMs);
    }

    // One more cancellation check before finalising — covers a click that
    // arrives during the final pause.
    const finalStatus = await selectStatus(deps.pg, job.id);
    if (finalStatus === 'cancelled') return 'cancelled';

    await finalizeAsDone(deps.supabase, job.id, buildStubReview(job));
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markErrored(deps.supabase, job.id, message);
    return 'errored';
  }
}
