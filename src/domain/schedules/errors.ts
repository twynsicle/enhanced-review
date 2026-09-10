/**
 * Failures the schedule service reports to its callers, mirroring
 * `domain/jobs/errors.ts`. The web layer maps them to HTTP: limit → 409,
 * duplicate → 409, not found → 404. Shared with the browser only as types.
 */
export class ScheduleNotFoundError extends Error {
  readonly scheduleId: string;
  constructor(scheduleId: string) {
    super(`schedule not found: ${scheduleId}`);
    this.name = 'ScheduleNotFoundError';
    this.scheduleId = scheduleId;
  }
}

export class ScheduleLimitError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`You already have ${String(limit)} schedules. Delete one before adding another.`);
    this.name = 'ScheduleLimitError';
    this.limit = limit;
  }
}

export class DuplicateScheduleError extends Error {
  constructor() {
    super('That target is already on a schedule.');
    this.name = 'DuplicateScheduleError';
  }
}
