import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../test/db.ts';
import { prisma } from './client.ts';
import { createJob } from './review-jobs.ts';
import {
  claimDueSchedules,
  completeRun,
  countSchedulesByStatus,
  countSchedulesForUser,
  createSchedule,
  deleteSchedule,
  failRun,
  findScheduleById,
  isDuplicateSchedule,
  listSchedulesForUser,
  pauseSchedule,
  releaseClaimedSchedules,
  releaseRun,
  resumeSchedule,
} from './review-schedules.ts';
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

const PAST = new Date('2026-05-04T09:00:00.000Z');
const FUTURE = new Date('2099-01-01T09:00:00.000Z');

async function makeUser(login: string, githubId: bigint) {
  return upsertUserFromGithub({ githubId, githubLogin: login, name: null, avatarUrl: null });
}

function scheduleInput(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    target: TARGET,
    targetKey: 'pr:acme/widgets#12',
    cadence: 'daily' as const,
    timeZone: 'UTC',
    hourOfDay: 9,
    nextRunAt: PAST,
    ...overrides,
  };
}

describeDb('review-schedules repository', () => {
  beforeEach(resetDb);

  it('creates an active schedule and reads it back with the owner login', async () => {
    const user = await makeUser('alice', 1n);
    const created = await createSchedule(scheduleInput(user.id));
    expect(created).toMatchObject({
      userId: user.id,
      githubLogin: 'alice',
      status: 'active',
      cadence: 'daily',
      timeZone: 'UTC',
      hourOfDay: 9,
      target: TARGET,
      consecutiveFailures: 0,
      lastJobId: null,
    });
    await expect(findScheduleById(created.id)).resolves.toEqual(created);
    await expect(findScheduleById('00000000-0000-7000-8000-000000000000')).resolves.toBeNull();
    await expect(listSchedulesForUser(user.id)).resolves.toHaveLength(1);
    await expect(countSchedulesForUser(user.id)).resolves.toBe(1);
  });

  it('refuses a second schedule for the same target, but not for another user', async () => {
    const alice = await makeUser('alice', 1n);
    const bob = await makeUser('bob', 2n);
    await createSchedule(scheduleInput(alice.id));

    const err = await createSchedule(scheduleInput(alice.id)).catch((e: unknown) => e);
    expect(isDuplicateSchedule(err)).toBe(true);
    expect(isDuplicateSchedule(new Error('unrelated'))).toBe(false);

    // The uniqueness is per person, not global.
    await expect(createSchedule(scheduleInput(bob.id))).resolves.toMatchObject({ userId: bob.id });
  });

  it('claims only what is due, and only once', async () => {
    const user = await makeUser('alice', 1n);
    const due = await createSchedule(scheduleInput(user.id));
    const later = await createSchedule(
      scheduleInput(user.id, { targetKey: 'branch:acme/widgets@main', nextRunAt: FUTURE }),
    );

    const now = new Date('2026-05-04T09:00:30.000Z');
    const first = await claimDueSchedules(now, 10);
    expect(first.map((s) => s.id)).toEqual([due.id]);
    expect(first[0]?.status).toBe('running');

    // A second pass finds nothing: the row is no longer `active`.
    await expect(claimDueSchedules(now, 10)).resolves.toEqual([]);
    await expect(findScheduleById(later.id)).resolves.toMatchObject({ status: 'active' });
  });

  it('claims the oldest due first and honours the batch size', async () => {
    const user = await makeUser('alice', 1n);
    const older = await createSchedule(
      scheduleInput(user.id, { nextRunAt: new Date('2026-05-01T09:00:00.000Z') }),
    );
    await createSchedule(scheduleInput(user.id, { targetKey: 'k2', nextRunAt: PAST }));

    const claimed = await claimDueSchedules(new Date('2026-05-04T10:00:00.000Z'), 1);
    expect(claimed.map((s) => s.id)).toEqual([older.id]);
  });

  it('completes a run: back to active, streak cleared, job recorded', async () => {
    const user = await makeUser('alice', 1n);
    const schedule = await createSchedule(scheduleInput(user.id));
    const job = await createJob({ userId: user.id, target: TARGET, headSha: 'head' });
    await claimDueSchedules(new Date('2026-05-04T09:00:30.000Z'), 10);

    await expect(
      completeRun(schedule.id, { nextRunAt: FUTURE, ranAt: PAST, jobId: job.id }),
    ).resolves.toBe(true);
    await expect(findScheduleById(schedule.id)).resolves.toMatchObject({
      status: 'active',
      nextRunAt: FUTURE,
      lastRunAt: PAST,
      lastJobId: job.id,
      consecutiveFailures: 0,
      lastError: null,
    });
    // Only a claimed schedule can be completed.
    await expect(
      completeRun(schedule.id, { nextRunAt: FUTURE, ranAt: PAST, jobId: job.id }),
    ).resolves.toBe(false);
  });

  it('releases a run without recording one', async () => {
    const user = await makeUser('alice', 1n);
    const schedule = await createSchedule(scheduleInput(user.id));
    await claimDueSchedules(new Date('2026-05-04T09:00:30.000Z'), 10);

    await expect(releaseRun(schedule.id, FUTURE)).resolves.toBe(true);
    await expect(findScheduleById(schedule.id)).resolves.toMatchObject({
      status: 'active',
      nextRunAt: FUTURE,
      lastRunAt: null,
      consecutiveFailures: 0,
    });
  });

  it('counts failures and parks the schedule at the cap', async () => {
    const user = await makeUser('alice', 1n);
    const schedule = await createSchedule(scheduleInput(user.id));

    for (const expected of ['active', 'active', 'failed'] as const) {
      await claimDueSchedules(new Date('2099-06-01T00:00:00.000Z'), 10);
      await expect(
        failRun(schedule.id, { message: 'x'.repeat(600), nextRunAt: PAST, maxFailures: 3 }),
      ).resolves.toBe(expected);
    }

    const parked = await findScheduleById(schedule.id);
    expect(parked).toMatchObject({ status: 'failed', consecutiveFailures: 3 });
    expect(parked?.lastError).toHaveLength(500);

    // A parked schedule is never claimed again.
    await expect(claimDueSchedules(new Date('2099-06-01T00:00:00.000Z'), 10)).resolves.toEqual([]);
    // And failRun only moves a claimed row.
    await expect(
      failRun(schedule.id, { message: 'again', nextRunAt: PAST, maxFailures: 3 }),
    ).resolves.toBeNull();
  });

  it('pauses and resumes only for the owner', async () => {
    const alice = await makeUser('alice', 1n);
    const bob = await makeUser('bob', 2n);
    const schedule = await createSchedule(scheduleInput(alice.id));

    await expect(pauseSchedule(schedule.id, bob.id)).resolves.toBe(false);
    await expect(findScheduleById(schedule.id)).resolves.toMatchObject({ status: 'active' });

    await expect(pauseSchedule(schedule.id, alice.id)).resolves.toBe(true);
    await expect(pauseSchedule(schedule.id, alice.id)).resolves.toBe(false);
    // A paused schedule is invisible to the tick.
    await expect(claimDueSchedules(new Date('2099-06-01T00:00:00.000Z'), 10)).resolves.toEqual([]);

    await expect(resumeSchedule(schedule.id, bob.id, FUTURE)).resolves.toBe(false);
    await expect(resumeSchedule(schedule.id, alice.id, FUTURE)).resolves.toBe(true);
    await expect(findScheduleById(schedule.id)).resolves.toMatchObject({
      status: 'active',
      nextRunAt: FUTURE,
      consecutiveFailures: 0,
    });
  });

  it('releases claims left behind by a process that died mid-tick', async () => {
    const user = await makeUser('alice', 1n);
    const schedule = await createSchedule(scheduleInput(user.id));
    await claimDueSchedules(new Date('2026-05-04T09:00:30.000Z'), 10);
    await expect(countSchedulesByStatus('running')).resolves.toBe(1);

    const now = new Date('2026-05-04T09:05:00.000Z');
    await expect(releaseClaimedSchedules(now)).resolves.toBe(1);
    await expect(releaseClaimedSchedules(now)).resolves.toBe(0);
    await expect(findScheduleById(schedule.id)).resolves.toMatchObject({
      status: 'active',
      nextRunAt: now,
    });
  });

  it('deletes the schedule and leaves the reviews it produced behind', async () => {
    const user = await makeUser('alice', 1n);
    const schedule = await createSchedule(scheduleInput(user.id));
    const job = await createJob({
      userId: user.id,
      target: TARGET,
      headSha: 'head',
      scheduleId: schedule.id,
    });
    expect(job.scheduleId).toBe(schedule.id);

    await expect(deleteSchedule(schedule.id)).resolves.toBe(true);
    await expect(deleteSchedule(schedule.id)).resolves.toBe(false);
    await expect(findScheduleById(schedule.id)).resolves.toBeNull();

    const orphaned = await prisma.reviewJob.findUnique({ where: { id: job.id } });
    expect(orphaned?.scheduleId).toBeNull();
  });

  it('answers the health counts', async () => {
    const user = await makeUser('alice', 1n);
    await createSchedule(scheduleInput(user.id));
    const paused = await createSchedule(scheduleInput(user.id, { targetKey: 'k2' }));
    await pauseSchedule(paused.id, user.id);

    await expect(countSchedulesByStatus('active')).resolves.toBe(1);
    await expect(countSchedulesByStatus('paused')).resolves.toBe(1);
    await expect(countSchedulesByStatus('failed')).resolves.toBe(0);
  });
});
