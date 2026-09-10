// @vitest-environment node
import { RouterContextProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateScheduleError, ScheduleLimitError } from '@/domain/schedules/errors';
import type { Schedule } from '@/domain/schedules/schedules.server';
import { userContext } from '@/web/auth/context.server';

const schedules = {
  listSchedulesForUser: vi.fn<() => Promise<Schedule[]>>(),
  toScheduleView: vi.fn((schedule: Schedule) => ({ id: schedule.id })),
  createSchedule: vi.fn<() => Promise<{ id: string }>>(),
  pauseSchedule: vi.fn<() => Promise<string>>(),
  resumeSchedule: vi.fn<() => Promise<string>>(),
  deleteSchedule: vi.fn<() => Promise<string>>(),
};
vi.mock('@/domain/schedules/schedules.server', () => schedules);

const { loader, action } = await import('./schedules');

const USER = { id: 'u1', githubLogin: 'alice', name: null, avatarUrl: null };
const TARGET = {
  kind: 'pr',
  owner: 'acme',
  repo: 'w',
  number: 3,
  headSha: 'h',
  baseSha: 'b',
  title: 't',
};

function contextFor(user: typeof USER | null) {
  const context = new RouterContextProvider();
  context.set(userContext, user);
  return context;
}

function post(body: Record<string, string>, user: typeof USER | null = USER) {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) form.set(key, value);
  const request = new Request('http://localhost/schedules', { method: 'POST', body: form });
  return action({ request, params: {}, context: contextFor(user) } as never);
}

const CREATE = {
  intent: 'create',
  target: JSON.stringify(TARGET),
  cadence: 'daily',
  timeZone: 'Europe/London',
  hourOfDay: '9',
};

beforeEach(() => {
  vi.clearAllMocks();
  schedules.listSchedulesForUser.mockResolvedValue([{ id: 's1' } as Schedule]);
  schedules.createSchedule.mockResolvedValue({ id: 's9' });
  schedules.pauseSchedule.mockResolvedValue('paused');
  schedules.resumeSchedule.mockResolvedValue('resumed');
  schedules.deleteSchedule.mockResolvedValue('deleted');
});

describe('/schedules loader', () => {
  it('lists only the viewer’s own schedules', async () => {
    const result = await loader({
      request: new Request('http://localhost/schedules'),
      params: {},
      context: contextFor(USER),
    } as never);
    expect(schedules.listSchedulesForUser).toHaveBeenCalledWith('u1');
    expect(result.schedules).toEqual([{ id: 's1' }]);
    expect(typeof result.serverNow).toBe('string');
  });
});

describe('/schedules create', () => {
  it('arms the target and redirects to the list', async () => {
    const res = (await post(CREATE)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/schedules');
    expect(schedules.createSchedule).toHaveBeenCalledWith({
      userId: 'u1',
      target: TARGET,
      cadence: 'daily',
      timeZone: 'Europe/London',
      hourOfDay: 9,
    });
  });

  it('answers 409 when the user is at their schedule cap', async () => {
    schedules.createSchedule.mockRejectedValue(new ScheduleLimitError(10));
    const res = (await post(CREATE)) as { data: unknown; init?: { status?: number } };
    expect(res.init?.status).toBe(409);
    expect(res.data).toMatchObject({ ok: false, reason: 'schedule_limit' });
  });

  it('answers 409 when the target is already armed', async () => {
    schedules.createSchedule.mockRejectedValue(new DuplicateScheduleError());
    const res = (await post(CREATE)) as { data: unknown; init?: { status?: number } };
    expect(res.init?.status).toBe(409);
    expect(res.data).toMatchObject({ ok: false, reason: 'duplicate_schedule' });
  });

  it('rejects an unknown time zone with 400 before touching the table', async () => {
    const thrown = (await post({ ...CREATE, timeZone: 'Mars/Olympus_Mons' }).catch(
      (e: unknown) => e,
    )) as { init?: { status?: number } };
    expect(thrown.init?.status).toBe(400);
    expect(schedules.createSchedule).not.toHaveBeenCalled();
  });

  it('rejects an hour outside 0..23 with 400', async () => {
    const thrown = (await post({ ...CREATE, hourOfDay: '24' }).catch((e: unknown) => e)) as {
      init?: { status?: number };
    };
    expect(thrown.init?.status).toBe(400);
  });

  it('rejects a malformed target with 400', async () => {
    const thrown = (await post({ ...CREATE, target: '{not json' }).catch((e: unknown) => e)) as {
      init?: { status?: number };
    };
    expect(thrown.init?.status).toBe(400);
  });
});

describe('/schedules owner actions', () => {
  it('passes the viewer through to pause', async () => {
    await expect(post({ intent: 'pause', scheduleId: 's1' })).resolves.toEqual({ ok: true });
    expect(schedules.pauseSchedule).toHaveBeenCalledWith({ scheduleId: 's1', userId: 'u1' });
  });

  it('passes the viewer through to resume', async () => {
    await expect(post({ intent: 'resume', scheduleId: 's1' })).resolves.toEqual({ ok: true });
    expect(schedules.resumeSchedule).toHaveBeenCalledWith({ scheduleId: 's1', userId: 'u1' });
  });

  it('answers 409 when a pause changes nothing', async () => {
    schedules.pauseSchedule.mockResolvedValue('not-pausable');
    const res = (await post({ intent: 'pause', scheduleId: 's1' })) as {
      data: unknown;
      init?: { status?: number };
    };
    expect(res.init?.status).toBe(409);
    expect(res.data).toMatchObject({ reason: 'not_schedulable' });
  });

  it('answers 404 when the schedule is already gone', async () => {
    schedules.deleteSchedule.mockResolvedValue('not-found');
    const res = (await post({ intent: 'delete', scheduleId: 's1' })) as {
      init?: { status?: number };
    };
    expect(res.init?.status).toBe(404);
  });

  it('rejects an unknown intent with 400', async () => {
    const thrown = (await post({ intent: 'detonate', scheduleId: 's1' }).catch(
      (e: unknown) => e,
    )) as { init?: { status?: number } };
    expect(thrown.init?.status).toBe(400);
  });

  it('sends a signed-out caller to /login', async () => {
    const thrown = (await post({ intent: 'pause', scheduleId: 's1' }, null).catch(
      (e: unknown) => e,
    )) as Response;
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('location')).toBe('/login');
  });
});
