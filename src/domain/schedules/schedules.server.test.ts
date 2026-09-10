import { describe, expect, it, vi } from 'vitest';
import type { ReviewScheduleRecord } from '../../db/review-schedules.ts';
import { DuplicateScheduleError, ScheduleLimitError } from './errors.ts';
import {
  createSchedule,
  deleteSchedule,
  parseSchedule,
  pauseSchedule,
  resumeSchedule,
  toScheduleView,
  type CreateScheduleDeps,
  type ResumeScheduleDeps,
  type Schedule,
} from './schedules.server.ts';

const NOW = new Date('2026-05-04T10:00:00.000Z');

const TARGET = {
  kind: 'pr' as const,
  owner: 'acme',
  repo: 'widgets',
  number: 12,
  headSha: 'head',
  baseSha: 'base',
  title: 'Add widgets',
};

function record(overrides: Partial<ReviewScheduleRecord> = {}): ReviewScheduleRecord {
  return {
    id: 's1',
    userId: 'u1',
    githubLogin: 'alice',
    target: TARGET,
    targetKey: 'pr:acme/widgets#12',
    cadence: 'daily',
    timeZone: 'UTC',
    hourOfDay: 9,
    status: 'active',
    nextRunAt: new Date('2026-05-05T09:00:00.000Z'),
    lastRunAt: null,
    lastJobId: null,
    consecutiveFailures: 0,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createDeps(overrides: Partial<CreateScheduleDeps> = {}): CreateScheduleDeps {
  return {
    create: vi.fn().mockResolvedValue(record()),
    countForUser: vi.fn().mockResolvedValue(0),
    isDuplicate: vi.fn().mockReturnValue(false),
    maxSchedulesPerUser: 10,
    now: () => NOW,
    ...overrides,
  };
}

describe('parseSchedule', () => {
  it('parses the stored target through the shared schema', () => {
    expect(parseSchedule(record()).target).toEqual(TARGET);
  });

  it('names the schedule when the stored target does not parse', () => {
    expect(() => parseSchedule(record({ target: { kind: 'nonsense' } }))).toThrow(/s1/);
  });
});

describe('toScheduleView', () => {
  it('hands the browser ISO strings, not Dates', () => {
    const view = toScheduleView(parseSchedule(record({ lastRunAt: NOW })));
    expect(view.nextRunAt).toBe('2026-05-05T09:00:00.000Z');
    expect(view.lastRunAt).toBe(NOW.toISOString());
    expect(view.createdAt).toBe(NOW.toISOString());
  });
});

describe('createSchedule', () => {
  it('stores the target key and the first run, then reports the new id', async () => {
    const d = createDeps();
    await expect(
      createSchedule(
        { userId: 'u1', target: TARGET, cadence: 'daily', timeZone: 'UTC', hourOfDay: 9 },
        d,
      ),
    ).resolves.toEqual({ id: 's1' });
    expect(d.create).toHaveBeenCalledWith({
      userId: 'u1',
      target: TARGET,
      targetKey: 'pr:acme/widgets#12',
      cadence: 'daily',
      timeZone: 'UTC',
      hourOfDay: 9,
      nextRunAt: new Date('2026-05-05T09:00:00.000Z'),
    });
  });

  it('refuses at the per-user cap before touching the table', async () => {
    const d = createDeps({ countForUser: vi.fn().mockResolvedValue(10) });
    await expect(
      createSchedule(
        { userId: 'u1', target: TARGET, cadence: 'daily', timeZone: 'UTC', hourOfDay: 9 },
        d,
      ),
    ).rejects.toBeInstanceOf(ScheduleLimitError);
    expect(d.create).not.toHaveBeenCalled();
  });

  it('turns the unique violation into DuplicateScheduleError', async () => {
    const d = createDeps({
      create: vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
      isDuplicate: vi.fn().mockReturnValue(true),
    });
    await expect(
      createSchedule(
        { userId: 'u1', target: TARGET, cadence: 'daily', timeZone: 'UTC', hourOfDay: 9 },
        d,
      ),
    ).rejects.toBeInstanceOf(DuplicateScheduleError);
  });

  it('lets an unrelated insert failure through unchanged', async () => {
    const boom = new Error('connection reset');
    const d = createDeps({ create: vi.fn().mockRejectedValue(boom) });
    await expect(
      createSchedule(
        { userId: 'u1', target: TARGET, cadence: 'daily', timeZone: 'UTC', hourOfDay: 9 },
        d,
      ),
    ).rejects.toBe(boom);
  });
});

describe('pauseSchedule', () => {
  it('passes the viewer through, so the repository can scope the update', async () => {
    const pause = vi.fn().mockResolvedValue(true);
    await expect(pauseSchedule({ scheduleId: 's1', userId: 'u1' }, { pause })).resolves.toBe(
      'paused',
    );
    expect(pause).toHaveBeenCalledWith('s1', 'u1');
  });

  it('reports not-pausable without saying whether it was ownership or state', async () => {
    const pause = vi.fn().mockResolvedValue(false);
    await expect(pauseSchedule({ scheduleId: 's1', userId: 'someone' }, { pause })).resolves.toBe(
      'not-pausable',
    );
  });
});

function resumeDeps(overrides: Partial<ResumeScheduleDeps> = {}): ResumeScheduleDeps {
  return {
    get: vi.fn().mockResolvedValue(parseSchedule(record({ status: 'paused' })) as Schedule),
    resume: vi.fn().mockResolvedValue(true),
    now: () => NOW,
    ...overrides,
  };
}

describe('resumeSchedule', () => {
  it('re-anchors the cadence to now instead of replaying what was missed', async () => {
    const d = resumeDeps();
    await expect(resumeSchedule({ scheduleId: 's1', userId: 'u1' }, d)).resolves.toBe('resumed');
    expect(d.resume).toHaveBeenCalledWith('s1', 'u1', new Date('2026-05-05T09:00:00.000Z'));
  });

  it('reports not-resumable for a schedule that is gone', async () => {
    const d = resumeDeps({ get: vi.fn().mockResolvedValue(null) });
    await expect(resumeSchedule({ scheduleId: 'ghost', userId: 'u1' }, d)).resolves.toBe(
      'not-resumable',
    );
    expect(d.resume).not.toHaveBeenCalled();
  });

  it('reports not-resumable when the conditional update moves nothing', async () => {
    const d = resumeDeps({ resume: vi.fn().mockResolvedValue(false) });
    await expect(resumeSchedule({ scheduleId: 's1', userId: 'u1' }, d)).resolves.toBe(
      'not-resumable',
    );
  });
});

describe('deleteSchedule', () => {
  it('reports what happened to the row', async () => {
    await expect(
      deleteSchedule(
        { scheduleId: 's1', userId: 'u1' },
        { remove: vi.fn().mockResolvedValue(true) },
      ),
    ).resolves.toBe('deleted');
    await expect(
      deleteSchedule(
        { scheduleId: 's1', userId: 'u1' },
        { remove: vi.fn().mockResolvedValue(false) },
      ),
    ).resolves.toBe('not-found');
  });
});
