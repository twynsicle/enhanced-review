import { prisma } from './client.ts';
import { type Prisma, type ScheduleCadence, type ScheduleStatus } from './generated/client.ts';

/**
 * `review_schedules` repository. Same shape as `review-jobs.ts`: every status
 * change is a conditional update that names the states it may leave from and
 * reports whether a row actually moved, so a scheduler tick, a pause from the
 * UI and boot recovery never race each other with read-then-write.
 *
 * The tick's claim (`active → running`) is the load-bearing one: two ticks —
 * or two processes, if someone ignores the one-process rule — can both list a
 * due schedule, but only one of them can move it.
 *
 * `target` comes back untyped; `domain/schedules` parses it, because the
 * layering rule keeps `db` below `domain`.
 */
export interface ReviewScheduleRecord {
  id: string;
  userId: string;
  /** Denormalised from `users` at read time, as in `review-jobs.ts`. */
  githubLogin: string;
  target: unknown;
  targetKey: string;
  cadence: ScheduleCadence;
  timeZone: string;
  hourOfDay: number;
  status: ScheduleStatus;
  nextRunAt: Date;
  lastRunAt: Date | null;
  lastJobId: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const SCHEDULE_RESUMABLE_STATUSES: readonly ScheduleStatus[] = ['paused', 'failed'];
export const SCHEDULE_PAUSABLE_STATUSES: readonly ScheduleStatus[] = ['active', 'failed'];

const LAST_ERROR_MAX = 500;

const scheduleSelect = {
  id: true,
  userId: true,
  target: true,
  targetKey: true,
  cadence: true,
  timeZone: true,
  hourOfDay: true,
  status: true,
  nextRunAt: true,
  lastRunAt: true,
  lastJobId: true,
  consecutiveFailures: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { githubLogin: true } },
} satisfies Prisma.ReviewScheduleSelect;

type ScheduleRow = Prisma.ReviewScheduleGetPayload<{ select: typeof scheduleSelect }>;

function toRecord(row: ScheduleRow): ReviewScheduleRecord {
  const { user, ...rest } = row;
  return { ...rest, githubLogin: user.githubLogin };
}

export interface CreateScheduleInput {
  userId: string;
  /** A `ReviewTarget`; validated by the caller, stored verbatim. */
  target: Prisma.InputJsonValue;
  targetKey: string;
  cadence: ScheduleCadence;
  timeZone: string;
  hourOfDay: number;
  nextRunAt: Date;
}

/**
 * Insert an `active` schedule. `(user_id, target_key)` is unique, so a second
 * arm of the same target raises a Prisma unique violation rather than
 * quietly doubling the cadence; the domain layer turns that into
 * `DuplicateScheduleError`.
 */
export async function createSchedule(input: CreateScheduleInput): Promise<ReviewScheduleRecord> {
  const row = await prisma.reviewSchedule.create({
    data: { ...input, status: 'active' },
    select: scheduleSelect,
  });
  return toRecord(row);
}

/**
 * True for the `(user_id, target_key)` unique violation `createSchedule`
 * raises. Kept here so the Prisma error code stays behind `src/db`.
 */
export function isDuplicateSchedule(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

export async function findScheduleById(id: string): Promise<ReviewScheduleRecord | null> {
  const row = await prisma.reviewSchedule.findUnique({ where: { id }, select: scheduleSelect });
  return row ? toRecord(row) : null;
}

/** The owner's schedules, newest first. */
export async function listSchedulesForUser(userId: string): Promise<ReviewScheduleRecord[]> {
  const rows = await prisma.reviewSchedule.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: scheduleSelect,
  });
  return rows.map(toRecord);
}

export function countSchedulesForUser(userId: string): Promise<number> {
  return prisma.reviewSchedule.count({ where: { userId } });
}

export function countSchedulesByStatus(status: ScheduleStatus): Promise<number> {
  return prisma.reviewSchedule.count({ where: { status } });
}

/**
 * Claim up to `limit` schedules that are due: list the oldest due first, then
 * move each one `active → running` on its own. A row another tick took in the
 * meantime fails its conditional update and is skipped, so a claimed batch is
 * exclusively this caller's.
 */
export async function claimDueSchedules(now: Date, limit: number): Promise<ReviewScheduleRecord[]> {
  const due = await prisma.reviewSchedule.findMany({
    where: { status: 'active', nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const claimed: ReviewScheduleRecord[] = [];
  for (const { id } of due) {
    const result = await prisma.reviewSchedule.updateMany({
      where: { id, status: 'active', nextRunAt: { lte: now } },
      data: { status: 'running' },
    });
    if (result.count === 0) continue;
    const row = await prisma.reviewSchedule.findUnique({ where: { id }, select: scheduleSelect });
    if (row) claimed.push(toRecord(row));
  }
  return claimed;
}

export interface CompleteRunInput {
  nextRunAt: Date;
  ranAt: Date;
  jobId: string;
}

/**
 * `running → active` after a launch that worked: record the run, point at the
 * job it created and clear the failure streak.
 */
export async function completeRun(id: string, input: CompleteRunInput): Promise<boolean> {
  const result = await prisma.reviewSchedule.updateMany({
    where: { id, status: 'running' },
    data: {
      status: 'active',
      nextRunAt: input.nextRunAt,
      lastRunAt: input.ranAt,
      lastJobId: input.jobId,
      consecutiveFailures: 0,
      lastError: null,
    },
  });
  return result.count > 0;
}

/**
 * `running → active` without recording a run: the tick decided not to launch
 * anything this time round, so neither the failure streak nor `last_run_at`
 * moves.
 */
export async function releaseRun(id: string, nextRunAt: Date): Promise<boolean> {
  const result = await prisma.reviewSchedule.updateMany({
    where: { id, status: 'running' },
    data: { status: 'active', nextRunAt },
  });
  return result.count > 0;
}

export interface FailRunInput {
  message: string;
  nextRunAt: Date;
  maxFailures: number;
}

/**
 * `running → active | failed` after a launch that threw. The streak is read
 * and written in one transaction so two ticks cannot both read "2" and both
 * write "3"; at `maxFailures` the schedule is parked and only the owner can
 * bring it back.
 */
export async function failRun(id: string, input: FailRunInput): Promise<ScheduleStatus | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.reviewSchedule.findUnique({
      where: { id },
      select: { status: true, consecutiveFailures: true },
    });
    if (!current || current.status !== 'running') return null;

    const failures = current.consecutiveFailures + 1;
    const status: ScheduleStatus = failures >= input.maxFailures ? 'failed' : 'active';
    await tx.reviewSchedule.updateMany({
      where: { id, status: 'running' },
      data: {
        status,
        nextRunAt: input.nextRunAt,
        consecutiveFailures: failures,
        lastError: input.message.slice(0, LAST_ERROR_MAX),
      },
    });
    return status;
  });
}

/**
 * `active | failed → paused`, only for the owner. As with `cancelJob`, the
 * conditional update *is* the authorisation check and callers must not tell
 * "not yours" from "not pausable" — that would leak ownership.
 */
export async function pauseSchedule(id: string, userId: string): Promise<boolean> {
  const result = await prisma.reviewSchedule.updateMany({
    where: { id, userId, status: { in: [...SCHEDULE_PAUSABLE_STATUSES] } },
    data: { status: 'paused' },
  });
  return result.count > 0;
}

/** `paused | failed → active`, only for the owner, with a fresh next run. */
export async function resumeSchedule(
  id: string,
  userId: string,
  nextRunAt: Date,
): Promise<boolean> {
  const result = await prisma.reviewSchedule.updateMany({
    where: { id, userId, status: { in: [...SCHEDULE_RESUMABLE_STATUSES] } },
    data: { status: 'active', nextRunAt, consecutiveFailures: 0, lastError: null },
  });
  return result.count > 0;
}

/**
 * Remove a schedule. Reports whether a row went away, so a double submit is
 * not an error. Jobs the schedule produced keep their reviews; their
 * `schedule_id` is set to null by the foreign key.
 */
export async function deleteSchedule(id: string): Promise<boolean> {
  const result = await prisma.reviewSchedule.deleteMany({ where: { id } });
  return result.count > 0;
}

/**
 * Every schedule left `running` → `active`, due now; returns how many. A
 * process that died mid-tick leaves its claims behind, and nothing else ever
 * clears them: the claim is only released by the tick that took it.
 */
export async function releaseClaimedSchedules(now = new Date()): Promise<number> {
  const result = await prisma.reviewSchedule.updateMany({
    where: { status: 'running' },
    data: { status: 'active', nextRunAt: now },
  });
  return result.count;
}
