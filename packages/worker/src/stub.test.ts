import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChunkBatcher } from './streaming/chunk-batcher';
import type { ReviewExecutor, ReviewExecutorInput, ReviewExecutorOutput } from './executor/types';
import { runStubJob } from './stub';
import type { ClaimedJob } from './types';

function fakeJob(): ClaimedJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    github_login: 'alice',
    target: {
      kind: 'pr',
      owner: 'foo',
      repo: 'bar',
      number: 7,
      headSha: 'a',
      baseSha: 'b',
      title: 'T',
    },
    head_sha: 'sha-current',
  };
}

interface SupabaseStub {
  inserts: { table: string; row: unknown }[];
  updates: { table: string; row: unknown; eq: { column: string; value: unknown } }[];
  client: SupabaseClient;
}

function fakeSupabase(): SupabaseStub {
  const inserts: SupabaseStub['inserts'] = [];
  const updates: SupabaseStub['updates'] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        update(row: unknown) {
          return {
            eq(column: string, value: unknown) {
              updates.push({ table, row, eq: { column, value } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { inserts, updates, client };
}

interface FakeBatcherLog {
  fragments: string[];
  flushed: boolean;
}

function fakeBatcher(log: FakeBatcherLog): ChunkBatcher {
  return {
    onChunk(text: string) {
      log.fragments.push(text);
    },
    async flush() {
      log.flushed = true;
    },
    getCount() {
      return log.fragments.length;
    },
  };
}

const SAMPLE_REVIEW = {
  prTitle: 'Stub',
  overviewSummary: 'sum',
  chapters: [
    { id: 'c1', title: 'first', insights: [], diffChunks: [] },
    { id: 'c2', title: 'second', insights: [], diffChunks: [] },
  ],
};

function makeFastExecutor(): { executor: ReviewExecutor; calls: ReviewExecutorInput[] } {
  const calls: ReviewExecutorInput[] = [];
  const executor: ReviewExecutor = {
    name: 'fake-stub',
    async run(input: ReviewExecutorInput): Promise<ReviewExecutorOutput> {
      calls.push(input);
      input.onChunk?.('<narrative_review>{"prTitle":"Stub","chapters":[');
      input.onChunk?.('{"id":"c1","title":"first"}]}</narrative_review>');
      return { review: SAMPLE_REVIEW, wasTruncated: false, rawText: 'raw' };
    },
  };
  return { executor, calls };
}

describe('runStubJob', () => {
  it('streams executor output via onChunk and finalises with the review', async () => {
    const supabase = fakeSupabase();
    const batcherLog: FakeBatcherLog = { fragments: [], flushed: false };
    const { executor, calls } = makeFastExecutor();

    const ac = new AbortController();
    const outcome = await runStubJob(
      {
        supabase: supabase.client,
        executor,
        createBatcher: () => fakeBatcher(batcherLog),
      },
      fakeJob(),
      ac.signal,
    );

    expect(outcome).toBe('done');
    expect(calls).toHaveLength(1);
    // Executor received the same onChunk the batcher exposes; both
    // fragments landed in the batcher.
    expect(batcherLog.fragments).toHaveLength(2);
    expect(batcherLog.flushed).toBe(true);

    const reviewInserts = supabase.inserts.filter((i) => i.table === 'reviews');
    expect(reviewInserts).toHaveLength(1);
    expect(reviewInserts[0]?.row).toMatchObject({ job_id: 'job-1', content: SAMPLE_REVIEW });

    expect(
      supabase.updates.some(
        (u) => u.table === 'review_jobs' && (u.row as { status?: string }).status === 'done',
      ),
    ).toBe(true);
  });

  it('returns "cancelled" without finalising when the signal is already aborted', async () => {
    const supabase = fakeSupabase();
    const batcherLog: FakeBatcherLog = { fragments: [], flushed: false };
    const ac = new AbortController();
    ac.abort();

    const executor: ReviewExecutor = {
      name: 'never',
      async run(input: ReviewExecutorInput) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        if (input.signal.aborted) throw err;
        throw new Error('should not run');
      },
    };

    const outcome = await runStubJob(
      {
        supabase: supabase.client,
        executor,
        createBatcher: () => fakeBatcher(batcherLog),
      },
      fakeJob(),
      ac.signal,
    );

    expect(outcome).toBe('cancelled');
    expect(supabase.inserts.find((i) => i.table === 'reviews')).toBeUndefined();
  });

  it('marks the job errored when the executor throws', async () => {
    const supabase = fakeSupabase();
    const batcherLog: FakeBatcherLog = { fragments: [], flushed: false };
    const executor: ReviewExecutor = {
      name: 'failing',
      async run() {
        throw new Error('boom');
      },
    };

    const outcome = await runStubJob(
      {
        supabase: supabase.client,
        executor,
        createBatcher: () => fakeBatcher(batcherLog),
      },
      fakeJob(),
      new AbortController().signal,
    );

    expect(outcome).toBe('errored');
    expect(
      supabase.updates.some(
        (u) =>
          u.table === 'review_jobs' &&
          (u.row as { status?: string; error_message?: string }).status === 'error',
      ),
    ).toBe(true);
  });

  it('always flushes the batcher in the finally block', async () => {
    const supabase = fakeSupabase();
    const batcherLog: FakeBatcherLog = { fragments: [], flushed: false };
    const flush = vi.fn(async () => {
      batcherLog.flushed = true;
    });
    const executor: ReviewExecutor = {
      name: 'mid',
      async run(input: ReviewExecutorInput) {
        input.onChunk?.('partial');
        throw new Error('mid-stream failure');
      },
    };

    const outcome = await runStubJob(
      {
        supabase: supabase.client,
        executor,
        createBatcher: () => ({
          onChunk(text: string) {
            batcherLog.fragments.push(text);
          },
          flush,
          getCount: () => batcherLog.fragments.length,
        }),
      },
      fakeJob(),
      new AbortController().signal,
    );

    expect(outcome).toBe('errored');
    // flush was called during the finally even though we threw mid-run.
    expect(flush).toHaveBeenCalled();
  });
});
