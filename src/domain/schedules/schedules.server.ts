import { logger } from '../../common/logger.ts';
import { env } from '../../config/env.ts';
import * as reviewSchedules from '../../db/review-schedules.ts';
import { ReviewTargetSchema, type ReviewTarget } from '../review/target.ts';
import { firstRunAt } from './cadence.ts';
import { DuplicateScheduleError, ScheduleLimitError } from './errors.ts';
import { scheduleTargetKey, type ScheduleCadence, type ScheduleView } from './schedule.ts';

/**
 * The service side of schedules: the read side loaders use, and the four
 * things an owner can do to one (create, pause, resume, delete).
 *
 * Authorisation follows `cancel-job.server.ts`: the owner check is the
 * `user_id` in the repository's conditional update, and the outcome union
 * deliberately cannot tell "not yours" from "not in a state that allows it",
 * so a response never leaks who owns what.
 *
 * JSON columns are parsed here rather than in the repository, because the
 * layering rule keeps `db` below `domain`.
 */
export interface Schedule extends Omit<reviewSchedules.ReviewScheduleRecord, 'target'> {
  target: ReviewTarget;
}

export function parseSchedule(record: reviewSchedules.ReviewScheduleRecord): Schedule {
  const target = ReviewTargetSchema.safeParse(record.target);
  if (!target.success) {
    throw new Error(
      `review_schedules.target is invalid for schedule ${record.id}: ${target.error.message}`,
    );
  }
  return { ...record, target: target.data };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from form fields; anything that is not a UUID is "not found". */
export async function getSchedule(id: string): Promise<Schedule | null> {
  if (!UUID.test(id)) return null;
  const record = await reviewSchedules.findScheduleById(id);
  return record ? parseSchedule(record) : null;
}

export async function listSchedulesForUser(userId: string): Promise<Schedule[]> {
  return (await reviewSchedules.listSchedulesForUser(userId)).map(parseSchedule);
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toScheduleView(schedule: Schedule): ScheduleView {
  return {
    id: schedule.id,
    userId: schedule.userId,
    githubLogin: schedule.githubLogin,
    target: schedule.target,
    cadence: schedule.cadence,
    timeZone: schedule.timeZone,
    hourOfDay: schedule.hourOfDay,
    status: schedule.status,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: iso(schedule.lastRunAt),
    lastJobId: schedule.lastJobId,
    consecutiveFailures: schedule.consecutiveFailures,
    lastError: schedule.lastError,
    createdAt: schedule.createdAt.toISOString(),
  };
}

// --- create ----------------------------------------------------------------

export interface CreateScheduleInput {
  userId: string;
  target: ReviewTarget;
  cadence: ScheduleCadence;
  timeZone: string;
  hourOfDay: number;
}

export interface CreateScheduleDeps {
  create: typeof reviewSchedules.createSchedule;
  countForUser: typeof reviewSchedules.countSchedulesForUser;
  isDuplicate: typeof reviewSchedules.isDuplicateSchedule;
  maxSchedulesPerUser: number;
  now: () => Date;
}

export function defaultCreateScheduleDeps(): CreateScheduleDeps {
  return {
    create: reviewSchedules.createSchedule,
    countForUser: reviewSchedules.countSchedulesForUser,
    isDuplicate: reviewSchedules.isDuplicateSchedule,
    maxSchedulesPerUser: env.MAX_SCHEDULES_PER_USER,
    now: () => new Date(),
  };
}

/**
 * Arm a target. The per-user cap is a count-then-insert, like the in-flight
 * job cap it mirrors; the *duplicate* check is not, because it does not have
 * to be — `(user_id, target_key)` is unique, so the race is settled by the
 * database and the violation comes back as `DuplicateScheduleError`.
 *
 * The target's SHAs are not re-pinned here. Every run resolves the head
 * afresh through `startReview`, so whatever the composer had in hand is only
 * a starting point.
 */
export async function createSchedule(
  input: CreateScheduleInput,
  deps: CreateScheduleDeps = defaultCreateScheduleDeps(),
): Promise<{ id: string }> {
  const existing = await deps.countForUser(input.userId);
  if (existing >= deps.maxSchedulesPerUser) throw new ScheduleLimitError(deps.maxSchedulesPerUser);

  const now = deps.now();
  try {
    const created = await deps.create({
      userId: input.userId,
      target: input.target,
      targetKey: scheduleTargetKey(input.target),
      cadence: input.cadence,
      timeZone: input.timeZone,
      hourOfDay: input.hourOfDay,
      nextRunAt: firstRunAt(input, now),
    });
    logger.info(
      { schedule_id: created.id, user_id: input.userId, cadence: input.cadence },
      'schedule created',
    );
    return { id: created.id };
  } catch (err) {
    if (deps.isDuplicate(err)) throw new DuplicateScheduleError();
    throw err;
  }
}

// --- owner actions ---------------------------------------------------------

export type PauseOutcome = 'paused' | 'not-pausable';
export type ResumeOutcome = 'resumed' | 'not-resumable';
export type DeleteOutcome = 'deleted' | 'not-found';

export interface OwnerActionInput {
  scheduleId: string;
  userId: string;
}

export interface PauseScheduleDeps {
  pause: typeof reviewSchedules.pauseSchedule;
}

export async function pauseSchedule(
  input: OwnerActionInput,
  deps: PauseScheduleDeps = { pause: reviewSchedules.pauseSchedule },
): Promise<PauseOutcome> {
  const paused = await deps.pause(input.scheduleId, input.userId);
  if (!paused) return 'not-pausable';
  logger.info({ schedule_id: input.scheduleId, user_id: input.userId }, 'schedule paused');
  return 'paused';
}

export interface ResumeScheduleDeps {
  get: (id: string) => Promise<Schedule | null>;
  resume: typeof reviewSchedules.resumeSchedule;
  now: () => Date;
}

export function defaultResumeScheduleDeps(): ResumeScheduleDeps {
  return { get: getSchedule, resume: reviewSchedules.resumeSchedule, now: () => new Date() };
}

/**
 * Resuming re-anchors the cadence to now rather than replaying whatever was
 * missed while it was paused: a schedule paused for a fortnight should not
 * fire the moment it comes back.
 */
export async function resumeSchedule(
  input: OwnerActionInput,
  deps: ResumeScheduleDeps = defaultResumeScheduleDeps(),
): Promise<ResumeOutcome> {
  const schedule = await deps.get(input.scheduleId);
  if (!schedule) return 'not-resumable';
  const resumed = await deps.resume(
    input.scheduleId,
    input.userId,
    firstRunAt(schedule, deps.now()),
  );
  if (!resumed) return 'not-resumable';
  logger.info({ schedule_id: input.scheduleId, user_id: input.userId }, 'schedule resumed');
  return 'resumed';
}

export interface DeleteScheduleDeps {
  remove: typeof reviewSchedules.deleteSchedule;
}

/**
 * Deleting is idempotent: a schedule that is already gone reports
 * `not-found` rather than throwing, so a double submit from two tabs is not
 * an error. Jobs the schedule produced keep their reviews.
 */
export async function deleteSchedule(
  input: OwnerActionInput,
  deps: DeleteScheduleDeps = { remove: reviewSchedules.deleteSchedule },
): Promise<DeleteOutcome> {
  const removed = await deps.remove(input.scheduleId);
  if (!removed) return 'not-found';
  logger.info({ schedule_id: input.scheduleId, user_id: input.userId }, 'schedule deleted');
  return 'deleted';
}
