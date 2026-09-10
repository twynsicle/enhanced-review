import { describe, expect, it } from 'vitest';
import { firstRunAt, instantOfLocal, isValidTimeZone, localPartsAt, nextRunAt } from './cadence.ts';

const UTC = { hourOfDay: 9, timeZone: 'UTC' } as const;
const NEW_YORK = { hourOfDay: 9, timeZone: 'America/New_York' } as const;

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects anything else', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});

describe('localPartsAt', () => {
  it('reads the wall clock in the named zone, not the host zone', () => {
    const instant = new Date('2026-01-15T14:30:00.000Z');
    expect(localPartsAt(instant, 'UTC')).toMatchObject({ hour: 14, minute: 30 });
    expect(localPartsAt(instant, 'America/New_York')).toMatchObject({ day: 15, hour: 9 });
    expect(localPartsAt(instant, 'Asia/Tokyo')).toMatchObject({ day: 15, hour: 23 });
  });

  it('prints midnight as hour 0', () => {
    expect(localPartsAt(new Date('2026-01-15T00:00:00.000Z'), 'UTC').hour).toBe(0);
  });
});

describe('instantOfLocal', () => {
  it('resolves a wall clock to the instant the zone was on at the time', () => {
    // Winter: New York is UTC-5. Summer: UTC-4.
    expect(
      instantOfLocal({ year: 2026, month: 1, day: 15, hour: 9 }, 'America/New_York').toISOString(),
    ).toBe('2026-01-15T14:00:00.000Z');
    expect(
      instantOfLocal({ year: 2026, month: 7, day: 15, hour: 9 }, 'America/New_York').toISOString(),
    ).toBe('2026-07-15T13:00:00.000Z');
  });

  it('normalises an overflowing day into the next month', () => {
    expect(instantOfLocal({ year: 2026, month: 1, day: 32, hour: 9 }, 'UTC').toISOString()).toBe(
      '2026-02-01T09:00:00.000Z',
    );
  });
});

describe('firstRunAt', () => {
  it('takes the next top of the hour for an hourly schedule', () => {
    expect(
      firstRunAt({ cadence: 'hourly', ...UTC }, new Date('2026-05-04T12:34:56.789Z')).toISOString(),
    ).toBe('2026-05-04T13:00:00.000Z');
  });

  it('takes today when the hour is still ahead, tomorrow when it is not', () => {
    expect(
      firstRunAt({ cadence: 'daily', ...UTC }, new Date('2026-05-04T08:00:00.000Z')).toISOString(),
    ).toBe('2026-05-04T09:00:00.000Z');
    expect(
      firstRunAt({ cadence: 'daily', ...UTC }, new Date('2026-05-04T10:00:00.000Z')).toISOString(),
    ).toBe('2026-05-05T09:00:00.000Z');
  });

  it('treats an exact hit as already past, so a run never fires twice', () => {
    expect(
      firstRunAt({ cadence: 'daily', ...UTC }, new Date('2026-05-04T09:00:00.000Z')).toISOString(),
    ).toBe('2026-05-05T09:00:00.000Z');
  });

  it('reads the hour in the schedule’s own zone, in both halves of the year', () => {
    expect(
      firstRunAt(
        { cadence: 'daily', ...NEW_YORK },
        new Date('2026-01-15T00:00:00.000Z'),
      ).toISOString(),
    ).toBe('2026-01-15T14:00:00.000Z');
    expect(
      firstRunAt(
        { cadence: 'daily', ...NEW_YORK },
        new Date('2026-07-01T00:00:00.000Z'),
      ).toISOString(),
    ).toBe('2026-07-01T13:00:00.000Z');
  });

  it('gives a weekly schedule the same first run as a daily one', () => {
    const from = new Date('2026-05-04T10:00:00.000Z');
    expect(firstRunAt({ cadence: 'weekly', ...UTC }, from).toISOString()).toBe(
      firstRunAt({ cadence: 'daily', ...UTC }, from).toISOString(),
    );
  });
});

describe('nextRunAt', () => {
  it('advances one period from the run that was due', () => {
    const due = new Date('2026-05-04T09:00:00.000Z');
    expect(
      nextRunAt(
        { cadence: 'hourly', ...UTC },
        due,
        new Date('2026-05-04T09:00:30.000Z'),
      ).toISOString(),
    ).toBe('2026-05-04T10:00:00.000Z');
    expect(
      nextRunAt(
        { cadence: 'daily', ...UTC },
        due,
        new Date('2026-05-04T09:00:30.000Z'),
      ).toISOString(),
    ).toBe('2026-05-05T09:00:00.000Z');
    expect(
      nextRunAt(
        { cadence: 'weekly', ...UTC },
        due,
        new Date('2026-05-04T09:00:30.000Z'),
      ).toISOString(),
    ).toBe('2026-05-11T09:00:00.000Z');
  });

  it('does not drift when the tick fires late', () => {
    // Due at 09:00, picked up at 09:04. The next run is still on the hour.
    expect(
      nextRunAt(
        { cadence: 'hourly', ...UTC },
        new Date('2026-05-04T09:00:00.000Z'),
        new Date('2026-05-04T09:04:12.000Z'),
      ).toISOString(),
    ).toBe('2026-05-04T10:00:00.000Z');
  });

  it('skips whole periods missed while the process was down', () => {
    expect(
      nextRunAt(
        { cadence: 'daily', ...UTC },
        new Date('2026-05-04T09:00:00.000Z'),
        new Date('2026-05-07T12:00:00.000Z'),
      ).toISOString(),
    ).toBe('2026-05-08T09:00:00.000Z');
  });
});
