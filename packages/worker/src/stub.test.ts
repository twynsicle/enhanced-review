import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Querier } from './db';
import { STUB_CHUNKS, buildStubReview, runStubJob } from './stub';
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

function fakeSupabase(opts: { failInsert?: boolean } = {}): SupabaseStub {
  const inserts: SupabaseStub['inserts'] = [];
  const updates: SupabaseStub['updates'] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          inserts.push({ table, row });
          return Promise.resolve({
            error: opts.failInsert && table === 'review_chunks' ? { message: 'boom' } : null,
          });
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

function fakePg(statusByCall: Array<string | null> | (() => string | null)): Querier {
  const queue =
    typeof statusByCall === 'function' ? null : ([...statusByCall] as Array<string | null>);
  const fn = typeof statusByCall === 'function' ? statusByCall : null;
  const query = vi.fn(async () => {
    const next = fn ? fn() : (queue!.shift() ?? null);
    return next === null ? { rows: [], rowCount: 0 } : { rows: [{ status: next }], rowCount: 1 };
  });
  return { query: query as unknown as Querier['query'] };
}

describe('runStubJob', () => {
  it('emits all 5 chunks then finalises with the stub review', async () => {
    const supabase = fakeSupabase();
    // selectStatus is called once per chunk + once before finalize → 6 times.
    const pg = fakePg(() => 'running');

    const outcome = await runStubJob(
      { pg, supabase: supabase.client, sleep: async () => undefined, chunkDelayMs: 0 },
      fakeJob(),
    );

    expect(outcome).toBe('done');
    const chunkInserts = supabase.inserts.filter((i) => i.table === 'review_chunks');
    expect(chunkInserts).toHaveLength(STUB_CHUNKS.length);
    chunkInserts.forEach((insert, i) => {
      expect(insert.row).toMatchObject({ job_id: 'job-1', seq: i, content: STUB_CHUNKS[i] });
    });
    const reviewInserts = supabase.inserts.filter((i) => i.table === 'reviews');
    expect(reviewInserts).toHaveLength(1);
    expect(supabase.updates).toEqual([
      expect.objectContaining({
        table: 'review_jobs',
        row: expect.objectContaining({ status: 'done' }),
        eq: { column: 'id', value: 'job-1' },
      }),
    ]);
  });

  it('exits early when status flips to cancelled mid-stream', async () => {
    const supabase = fakeSupabase();
    // chunk 0: running, chunk 1: cancelled — should emit one chunk only and skip finalize.
    const pg = fakePg(['running', 'cancelled']);

    const outcome = await runStubJob(
      { pg, supabase: supabase.client, sleep: async () => undefined, chunkDelayMs: 0 },
      fakeJob(),
    );

    expect(outcome).toBe('cancelled');
    expect(supabase.inserts.filter((i) => i.table === 'review_chunks')).toHaveLength(1);
    expect(supabase.inserts.filter((i) => i.table === 'reviews')).toHaveLength(0);
    // No status update either — the API already wrote 'cancelled'.
    expect(supabase.updates).toEqual([]);
  });

  it('cancels even on the final pre-finalize status check', async () => {
    const supabase = fakeSupabase();
    // 5 running checks for the chunks + 1 cancelled at the gate before finalize.
    const pg = fakePg(['running', 'running', 'running', 'running', 'running', 'cancelled']);

    const outcome = await runStubJob(
      { pg, supabase: supabase.client, sleep: async () => undefined, chunkDelayMs: 0 },
      fakeJob(),
    );

    expect(outcome).toBe('cancelled');
    expect(supabase.inserts.filter((i) => i.table === 'review_chunks')).toHaveLength(5);
    expect(supabase.inserts.filter((i) => i.table === 'reviews')).toHaveLength(0);
  });

  it('marks the job errored when an insert fails', async () => {
    const supabase = fakeSupabase({ failInsert: true });
    const pg = fakePg(() => 'running');

    const outcome = await runStubJob(
      { pg, supabase: supabase.client, sleep: async () => undefined, chunkDelayMs: 0 },
      fakeJob(),
    );

    expect(outcome).toBe('errored');
    expect(
      supabase.updates.some(
        (u) => u.table === 'review_jobs' && (u.row as { status?: string }).status === 'error',
      ),
    ).toBe(true);
  });
});

describe('buildStubReview', () => {
  it('uses the PR title for a PR target', () => {
    const job = fakeJob();
    const review = buildStubReview(job);
    expect(review.prTitle).toBe('T');
    expect(review.chapters).toHaveLength(2);
  });

  it('falls back to a branch-derived title for branch targets', () => {
    const job: ClaimedJob = {
      ...fakeJob(),
      target: {
        kind: 'branch',
        owner: 'foo',
        repo: 'bar',
        ref: 'feature/x',
        headSha: 'a',
        baseRef: 'main',
        baseSha: 'b',
      },
    };
    expect(buildStubReview(job).prTitle).toBe('Branch feature/x');
  });
});
