import type { ReviewTarget } from '../review/target.ts';

/**
 * Schedule vocabulary for code that ships to the browser. Mirrors the Prisma
 * `ScheduleStatus` / `ScheduleCadence` enums (which only `src/db` may import),
 * the same way `jobs/status.ts` mirrors `JobStatus`.
 *
 * The lifecycle:
 *
 *   active ──claim──▶ running ──launched──▶ active
 *      │                  │
 *      │                  └──failed too often──▶ failed
 *      │                                            │
 *      └──owner pauses──▶ paused ◀──owner pauses─────┘
 *                            │
 *                            └──owner resumes──▶ active
 *
 * `running` is held only for the moments a tick spends launching a job; it is
 * a claim, not a phase the user waits in. Nothing but the tick that took it —
 * or boot recovery, for a claim whose process died — puts it back.
 */
export const SCHEDULE_STATUSES = ['active', 'running', 'paused', 'failed'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_CADENCES = ['hourly', 'daily', 'weekly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];

/** The owner can act on a schedule in these states; `running` is the tick's. */
export function isOwnerActionable(status: ScheduleStatus): boolean {
  return status !== 'running';
}

/**
 * The browser-facing shape of a schedule: ISO timestamps instead of `Date`s,
 * as with `JobView`. Built by `toScheduleView` in `schedules.server.ts`.
 */
export interface ScheduleView {
  id: string;
  userId: string;
  githubLogin: string;
  target: ReviewTarget;
  cadence: ScheduleCadence;
  timeZone: string;
  hourOfDay: number;
  status: ScheduleStatus;
  nextRunAt: string;
  lastRunAt: string | null;
  lastJobId: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  createdAt: string;
}

/**
 * The identity a schedule is unique on, per user. Two arms of the same pull
 * request or the same branch are the same standing instruction, so the
 * database rejects the second one rather than doubling the cadence.
 */
export function scheduleTargetKey(target: ReviewTarget): string {
  if (target.kind === 'pr') {
    return `pr:${target.owner}/${target.repo}#${String(target.number)}`;
  }
  return `branch:${target.owner}/${target.repo}@${target.ref}`;
}

/** "Every hour" / "Daily at 09:00 Europe/London". One line for a list row. */
export function describeCadence(
  cadence: ScheduleCadence,
  hourOfDay: number,
  timeZone: string,
): string {
  if (cadence === 'hourly') return 'Every hour';
  const at = `${String(hourOfDay).padStart(2, '0')}:00 ${timeZone}`;
  return cadence === 'daily' ? `Daily at ${at}` : `Weekly at ${at}`;
}
