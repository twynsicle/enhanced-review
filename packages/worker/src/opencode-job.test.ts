import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { runOpencodeJob } from './opencode-job';
import type { ReviewExecutor } from './executor/types';
import type { GitRunOptions, GitRunResult } from './clone/git-runner';
import { StreamCapExceededError, type ChunkBatcher } from './streaming/chunk-batcher';
import type { ClaimedJob } from './types';

interface SupabaseLog {
  rpcCalls: { name: string; args: unknown }[];
  inserts: { table: string; row: unknown }[];
  updates: { table: string; row: unknown; eqValue: unknown }[];
  client: SupabaseClient;
}

function fakeSupabase(opts: { token?: string | null } = {}): SupabaseLog {
  const log: Pick<SupabaseLog, 'rpcCalls' | 'inserts' | 'updates'> = {
    rpcCalls: [],
    inserts: [],
    updates: [],
  };
  const client = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      log.rpcCalls.push({ name, args });
      if (name === 'decrypt_review_job_token') {
        return { data: opts.token ?? 'gho_dummy_token', error: null };
      }
      return { data: null, error: null };
    }),
    from(table: string) {
      return {
        insert(row: unknown) {
          log.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        update(row: unknown) {
          return {
            eq(_column: string, value: unknown) {
              log.updates.push({ table, row, eqValue: value });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { ...log, client };
}

function fakeGitRunner(scripted: { match: (a: readonly string[]) => boolean; result: GitRunResult }[]) {
  const calls: GitRunOptions[] = [];
  const runner = async (opts: GitRunOptions): Promise<GitRunResult> => {
    calls.push(opts);
    const match = scripted.find((s) => s.match(opts.args));
    if (!match) {
      throw new Error(`fake git: no script for args [${opts.args.join(' ')}]`);
    }
    return match.result;
  };
  return { runner, calls };
}

const SAMPLE_REVIEW = {
  prTitle: 'Test PR',
  overviewSummary: 'sum',
  chapters: [
    {
      id: 'c1',
      title: 't',
      insights: [],
      diffChunks: [],
    },
  ],
};

const fakeExecutor: ReviewExecutor = {
  name: 'fake',
  async run() {
    return { review: SAMPLE_REVIEW, wasTruncated: false, rawText: 'raw' };
  },
};

const PR_JOB: ClaimedJob = {
  id: 'job-1',
  user_id: 'u',
  github_login: 'alice',
  target: {
    kind: 'branch',
    owner: 'a',
    repo: 'b',
    ref: 'feature/x',
    headSha: 'a11ce0',
    baseRef: 'main',
    baseSha: 'b00b00b',
  },
  head_sha: 'a11ce0',
};

describe('runOpencodeJob', () => {
  it('clones, clears the token, runs the executor, and finalises the job', async () => {
    const supabase = fakeSupabase();
    const { runner } = fakeGitRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'rev-parse', result: { stdout: 'a11ce0\n', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'fetch', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff' && a[1] === '--numstat', result: { stdout: '1\t0\tsrc/a.ts\n', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff' && a[1] === '--name-status', result: { stdout: 'M\tsrc/a.ts\n', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff', result: { stdout: 'diff --git a/src/a.ts b/src/a.ts\n', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'log', result: { stdout: 'Author Name\n--BODY--\nbody text\n', stderr: '', exitCode: 0 } },
    ]);

    const ac = new AbortController();
    const outcome = await runOpencodeJob(
      { supabase: supabase.client, executor: fakeExecutor, gitRunner: runner, model: 'opencode-zen/glm-4.7' },
      PR_JOB,
      ac.signal,
    );

    expect(outcome).toBe('done');

    // Token decryption happened before clone.
    const decryptCall = supabase.rpcCalls.find((c) => c.name === 'decrypt_review_job_token');
    expect(decryptCall?.args).toEqual({ p_job_id: 'job-1' });

    // Token was cleared (UPDATE setting github_token_encrypted = null).
    const tokenClears = supabase.updates.filter(
      (u) =>
        u.table === 'review_jobs' &&
        (u.row as { github_token_encrypted?: unknown }).github_token_encrypted === null,
    );
    expect(tokenClears).toHaveLength(1);

    // Reviews row written with the executor's review and diff_truncated false.
    const reviewInserts = supabase.inserts.filter((i) => i.table === 'reviews');
    expect(reviewInserts).toHaveLength(1);
    expect(reviewInserts[0]?.row).toMatchObject({
      job_id: 'job-1',
      content: SAMPLE_REVIEW,
      diff_truncated: false,
    });

    // Final status flip to 'done'.
    expect(
      supabase.updates.some(
        (u) =>
          u.table === 'review_jobs' &&
          (u.row as { status?: string }).status === 'done',
      ),
    ).toBe(true);
  });

  it('returns "cancelled" without writing a review when the signal aborts mid-flight', async () => {
    const supabase = fakeSupabase();
    const ac = new AbortController();
    ac.abort();

    const executor: ReviewExecutor = {
      name: 'never',
      async run() {
        throw new Error('should not run');
      },
    };
    const { runner } = fakeGitRunner([
      // The clone runner checks the signal at the spawn point; the fake
      // runner simply records calls. We expect the path to short-circuit
      // before any of these are needed.
    ]);

    const outcome = await runOpencodeJob(
      { supabase: supabase.client, executor, gitRunner: runner, model: 'm' },
      PR_JOB,
      ac.signal,
    );
    expect(outcome).toBe('cancelled');
    expect(supabase.inserts.find((i) => i.table === 'reviews')).toBeUndefined();
  });

  it('marks the job errored with "stream cap exceeded" when the batcher throws', async () => {
    const supabase = fakeSupabase();
    const { runner } = fakeGitRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'rev-parse', result: { stdout: 'a11ce0\n', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'fetch', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff' && a[1] === '--numstat', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff' && a[1] === '--name-status', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'log', result: { stdout: 'a\n--BODY--\nb\n', stderr: '', exitCode: 0 } },
    ]);

    const capExecutor: ReviewExecutor = {
      name: 'cap',
      async run(input) {
        // Simulate the executor surfacing a batcher cap throw.
        try {
          input.onChunk?.('over-the-cap');
        } catch (err) {
          throw err;
        }
        throw new Error('unreachable');
      },
    };

    const fakeBatcher: ChunkBatcher = {
      onChunk: () => {
        throw new StreamCapExceededError(5000);
      },
      flush: async () => undefined,
      getCount: () => 5000,
    };

    const ac = new AbortController();
    const outcome = await runOpencodeJob(
      {
        supabase: supabase.client,
        executor: capExecutor,
        gitRunner: runner,
        model: 'm',
        createBatcher: () => fakeBatcher,
      },
      PR_JOB,
      ac.signal,
    );

    expect(outcome).toBe('errored');
    expect(supabase.inserts.find((i) => i.table === 'reviews')).toBeUndefined();
    const errUpdate = supabase.updates.find(
      (u) =>
        u.table === 'review_jobs' &&
        (u.row as { status?: string }).status === 'error',
    );
    expect(errUpdate).toBeDefined();
    expect(
      (errUpdate?.row as { error_message?: string } | undefined)?.error_message,
    ).toBe('stream cap exceeded');
  });

  it('marks the job errored when the executor throws', async () => {
    const supabase = fakeSupabase();
    const { runner } = fakeGitRunner([
      { match: (a) => a[0] === 'clone', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'rev-parse', result: { stdout: 'a11ce0\n', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'fetch', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff' && a[1] === '--numstat', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff' && a[1] === '--name-status', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'diff', result: { stdout: '', stderr: '', exitCode: 0 } },
      { match: (a) => a[0] === 'log', result: { stdout: 'a\n--BODY--\nb\n', stderr: '', exitCode: 0 } },
    ]);
    const failingExecutor: ReviewExecutor = {
      name: 'fail',
      async run() {
        throw new Error('boom');
      },
    };
    const ac = new AbortController();

    const outcome = await runOpencodeJob(
      { supabase: supabase.client, executor: failingExecutor, gitRunner: runner, model: 'm' },
      PR_JOB,
      ac.signal,
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
});
