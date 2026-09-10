import type { ScheduleCadence } from './schedule.ts';

/**
 * When a schedule is due. Pure, shared with the browser (the schedules page
 * previews the next run as you pick a cadence), so there is no date library
 * here — `Intl.DateTimeFormat` already knows every IANA zone, which is enough
 * to turn a wall-clock hour into an instant and back.
 *
 * A schedule is stored as a cadence plus a *local* hour in a named zone, not
 * as a UTC hour: "every weekday at 09:00" means nine in the morning where the
 * owner is, in July and in January alike.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

const CADENCE_MS: Record<ScheduleCadence, number> = {
  hourly: HOUR_MS,
  daily: DAY_MS,
  weekly: WEEK_MS,
};

export interface CadenceInput {
  cadence: ScheduleCadence;
  /** Local hour, 0..23. Ignored by `hourly`. */
  hourOfDay: number;
  /** IANA zone name. */
  timeZone: string;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** True when `Intl` recognises the zone; the create action rejects the rest. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** What the clock in `timeZone` reads at `instant`. */
export function localPartsAt(instant: Date, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    // h23 still prints midnight as "24" in some ICU builds.
    hour: value('hour') % 24,
    minute: value('minute'),
    second: value('second'),
  };
}

/** The zone's offset from UTC at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = localPartsAt(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the clock in `timeZone` reads the given wall-clock
 * date at `hour:00:00`. Two passes: the first guess reads the wall clock as
 * if it were UTC, the second corrects it with the offset actually in force
 * there. Month and day may overflow (day 32, month 13) — `Date.UTC`
 * normalises them, which is how "the same time tomorrow" is written below.
 */
export function instantOfLocal(
  parts: { year: number; month: number; day: number; hour: number },
  timeZone: string,
): Date {
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, 0, 0);
  const firstPass = wall - zoneOffsetMs(new Date(wall), timeZone);
  return new Date(wall - zoneOffsetMs(new Date(firstPass), timeZone));
}

/**
 * The first run of a newly created (or resumed) schedule: the next instant
 * strictly after `from` at which the schedule's wall clock reads its hour.
 * `hourly` ignores the hour and takes the next top of the hour.
 */
export function firstRunAt(input: CadenceInput, from: Date): Date {
  if (input.cadence === 'hourly') {
    return new Date(Math.floor(from.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
  }
  const local = localPartsAt(from, input.timeZone);
  const today = instantOfLocal({ ...local, hour: input.hourOfDay }, input.timeZone);
  if (today.getTime() > from.getTime()) return today;
  return instantOfLocal(
    { year: local.year, month: local.month, day: local.day + 1, hour: input.hourOfDay },
    input.timeZone,
  );
}

/**
 * The instant after `previous` at which the schedule is next due.
 *
 * Advancing from the run that was *due* rather than from `now` keeps the
 * cadence anchored: a tick that fires ninety seconds late must not walk every
 * later run ninety seconds further out. Periods missed while the schedule was
 * paused, or while the process was down, are skipped rather than replayed —
 * nobody wants nine reviews at once on Monday morning.
 */
export function nextRunAt(input: CadenceInput, previous: Date, now: Date): Date {
  const step = CADENCE_MS[input.cadence];
  let next = previous.getTime() + step;
  while (next <= now.getTime()) next += step;
  return new Date(next);
}
