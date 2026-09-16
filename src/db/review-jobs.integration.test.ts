import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../test/db.ts';
import { prisma } from './client.ts';
import {
  cancelJob,
  countErrorsSince,
  countJobsByStatus,
  createJob,
  finalizeDone,
  findInFlightJob,
  findJobById,
  listJobCreatedAtSince,
  listJobs,
  listTerminalJobsSince,
  markErrored,
  markRunning,
  oldestPendingCreatedAt,
  recoverOrphans,
} from './review-jobs.ts';
import { findReviewByJobId } from './reviews.ts';
import { upsertUserFromGithub } from './users.ts';

const TARGET = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  headSha: 'head',
  baseSha: 'base',
  title: 'Add widgets',
};

async function makeUser(login: string, githubId: bigint) {
  return upsertUserFromGithub({ githubId, githubLogin: login, name: null, avatarUrl: null });
}

describeDb('review-jobs repository', () => {
  beforeEach(resetDb);

  it('creates a pending job and reads it back with the owner login', async () => {
    const user = await makeUser('alice', 1n);
    const created = await createJob({ userId: user.id, target: TARGET, headSha: 'head' });
    expect(created).toMatchObject({
      userId: user.id,
      githubLogin: 'alice',
      status: 'pending',
      headSha: 'head',
      target: TARGET,
      riskScore: null,
    });
    await expect(findJobById(created.id)).resolves.toEqual(created);
    await expect(findJobById('00000000-0000-7000-8000-000000000000')).resolves.toBeNull();
  });

  it('walks pending → running → done atomically with the review row', async () => {
    const user = await makeUser('alice', 1n);
    const job = await createJob({ userId: user.id, target: TARGET, headSha: 'head' });

    await expect(markRunning(job.id)).resolves.toBe(true);
    await expect(markRunning(job.id)).resolves.toBe(false);

    const content = { prTitle: 'x', overviewSummary: { lede: 'y' }, chapters: [] };
    const FINDINGS = [
      { code: 'diff-truncated', severity: 'warning', message: 'Part of the change was not shown.' },
    ];
    await expect(
      finalizeDone(job.id, { content, findings: FINDINGS, diffTruncated: true, riskScore: 3 }),
    ).resolves.toBe(true);

    const done = await findJobById(job.id);
    expect(done).toMatchObject({ status: 'done', riskScore: 3 });
    expect(done?.startedAt).toBeInstanceOf(Date);
    expect(done?.completedAt).toBeInstanceOf(Date);
    await expect(findReviewByJobId(job.id)).resolves.toMatchObject({
      jobId: job.id,
      content,
      findings: FINDINGS,
      diffTruncated: true,
    });

    // A second finalize neither flips anything nor inserts a duplicate review.
    await expect(
      finalizeDone(job.id, { content, findings: [], diffTruncated: false, riskScore: 1 }),
    ).resolves.toBe(false);
    await expect(prisma.review.count()).resolves.toBe(1);
  });

  it('refuses to finalize a job that is not running and writes no review', async () => {
    const user = await makeUser('alice', 1n);
    const job = await createJob({ userId: user.id, target: TARGET, headSha: 'head' });
    await expect(
      finalizeDone(job.id, { content: {}, findings: [], diffTruncated: false, riskScore: null }),
    ).resolves.toBe(false);
    await expect(prisma.review.count()).resolves.toBe(0);
    await expect(findJobById(job.id)).resolves.toMatchObject({ status: 'pending' });
  });

  it('marks in-flight jobs errored with a clipped message, once', async () => {
    const user = await makeUser('alice', 1n);
    const job = await createJob({ userId: user.id, target: TARGET, headSha: 'head' });
    await expect(markErrored(job.id, 'x'.repeat(600))).resolves.toBe(true);
    const row = await findJobById(job.id);
    expect(row?.status).toBe('error');
    expect(row?.errorMessage).toHaveLength(500);
    await expect(markErrored(job.id, 'again')).resolves.toBe(false);
    await expect(markRunning(job.id)).resolves.toBe(false);
  });

  it('cancels only for the owner and only while in flight', async () => {
    const alice = await makeUser('alice', 1n);
    const bob = await makeUser('bob', 2n);
    const job = await createJob({ userId: alice.id, target: TARGET, headSha: 'head' });

    await expect(cancelJob(job.id, bob.id)).resolves.toBe(false);
    await expect(findJobById(job.id)).resolves.toMatchObject({ status: 'pending' });

    await markRunning(job.id);
    await expect(cancelJob(job.id, alice.id)).resolves.toBe(true);
    const row = await findJobById(job.id);
    expect(row?.status).toBe('cancelled');
    expect(row?.cancelledAt).toBeInstanceOf(Date);

    await expect(cancelJob(job.id, alice.id)).resolves.toBe(false);
    await expect(markRunning(job.id)).resolves.toBe(false);
    await expect(
      finalizeDone(job.id, { content: {}, findings: [], diffTruncated: false, riskScore: null }),
    ).resolves.toBe(false);
  });

  it('reports the in-flight job at the cap and nothing below it', async () => {
    const user = await makeUser('alice', 1n);
    await expect(findInFlightJob(user.id, 1)).resolves.toBeNull();

    const first = await createJob({ userId: user.id, target: TARGET, headSha: 'a' });
    await expect(findInFlightJob(user.id, 1)).resolves.toEqual({
      id: first.id,
      status: 'pending',
    });
    await expect(findInFlightJob(user.id, 2)).resolves.toBeNull();

    await markRunning(first.id);
    await finalizeDone(first.id, {
      content: {},
      findings: [],
      diffTruncated: false,
      riskScore: null,
    });
    await expect(findInFlightJob(user.id, 1)).resolves.toBeNull();
  });

  it('lists newest first with an optional status filter', async () => {
    const user = await makeUser('alice', 1n);
    const a = await createJob({ userId: user.id, target: TARGET, headSha: 'a' });
    const b = await createJob({ userId: user.id, target: TARGET, headSha: 'b' });
    await markRunning(b.id);

    const all = await listJobs({ limit: 10 });
    expect(all.map((j) => j.id)).toEqual([b.id, a.id]);
    const running = await listJobs({ status: 'running', limit: 10 });
    expect(running.map((j) => j.id)).toEqual([b.id]);
    await expect(listJobs({ limit: 1 })).resolves.toHaveLength(1);
  });

  it('returns creation timestamps for the activity window', async () => {
    const user = await makeUser('alice', 1n);
    await createJob({ userId: user.id, target: TARGET, headSha: 'a' });
    const old = await createJob({ userId: user.id, target: TARGET, headSha: 'b' });
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    await prisma.reviewJob.update({ where: { id: old.id }, data: { createdAt: twentyDaysAgo } });

    const fourteenDays = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    const stamps = await listJobCreatedAtSince(fourteenDays);
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.getTime()).toBeGreaterThan(fourteenDays.getTime());
  });

  it('lists a user’s terminal transitions since a point in time', async () => {
    const alice = await makeUser('alice', 1n);
    const bob = await makeUser('bob', 2n);
    const before = new Date(Date.now() - 1000);

    const mine = await createJob({ userId: alice.id, target: TARGET, headSha: 'a' });
    const stillRunning = await createJob({ userId: alice.id, target: TARGET, headSha: 'b' });
    const theirs = await createJob({ userId: bob.id, target: TARGET, headSha: 'c' });
    await markErrored(mine.id, 'boom');
    await markRunning(stillRunning.id);
    await markErrored(theirs.id, 'boom');

    const rows = await listTerminalJobsSince(alice.id, before);
    expect(rows.map((j) => j.id)).toEqual([mine.id]);
    await expect(listTerminalJobsSince(alice.id, new Date(Date.now() + 60_000))).resolves.toEqual(
      [],
    );
  });

  it('recovers every in-flight job and leaves terminal ones alone', async () => {
    const user = await makeUser('alice', 1n);
    const pending = await createJob({ userId: user.id, target: TARGET, headSha: 'a' });
    const running = await createJob({ userId: user.id, target: TARGET, headSha: 'b' });
    const cancelled = await createJob({ userId: user.id, target: TARGET, headSha: 'c' });
    await markRunning(running.id);
    await cancelJob(cancelled.id, user.id);

    await expect(recoverOrphans('interrupted: server restarted')).resolves.toBe(2);
    await expect(recoverOrphans('interrupted: server restarted')).resolves.toBe(0);
    for (const id of [pending.id, running.id]) {
      await expect(findJobById(id)).resolves.toMatchObject({
        status: 'error',
        errorMessage: 'interrupted: server restarted',
      });
    }
    await expect(findJobById(cancelled.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('answers the health counts', async () => {
    const user = await makeUser('alice', 1n);
    await expect(oldestPendingCreatedAt()).resolves.toBeNull();
    const first = await createJob({ userId: user.id, target: TARGET, headSha: 'a' });
    await createJob({ userId: user.id, target: TARGET, headSha: 'b' });
    const errored = await createJob({ userId: user.id, target: TARGET, headSha: 'c' });
    await markErrored(errored.id, 'boom');

    await expect(countJobsByStatus('pending')).resolves.toBe(2);
    await expect(countJobsByStatus('error')).resolves.toBe(1);
    await expect(oldestPendingCreatedAt()).resolves.toEqual(first.createdAt);
    await expect(countErrorsSince(new Date(Date.now() - 60_000))).resolves.toBe(1);
    await expect(countErrorsSince(new Date(Date.now() + 60_000))).resolves.toBe(0);
  });
});
