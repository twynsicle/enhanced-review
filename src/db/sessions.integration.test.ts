import { beforeEach, expect, it } from 'vitest';
import { describeDb, resetDb } from '../test/db.ts';
import { prisma } from './client.ts';
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  readSession,
  updateSession,
} from './sessions.ts';
import { upsertUserFromGithub } from './users.ts';

const inOneHour = () => new Date(Date.now() + 60 * 60 * 1000);
const oneHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

describeDb('sessions repository', () => {
  beforeEach(resetDb);

  it('round-trips data and lifts userId out of the payload', async () => {
    const user = await upsertUserFromGithub({
      githubId: 1n,
      githubLogin: 'one',
      name: null,
      avatarUrl: null,
    });
    const id = await createSession({ userId: user.id, flash: 'hi' }, inOneHour());

    const row = await readSession(id);
    expect(row).toMatchObject({ id, userId: user.id, data: { userId: user.id, flash: 'hi' } });
  });

  it('returns null for expired or unknown sessions', async () => {
    const id = await createSession({ userId: null }, oneHourAgo());
    await expect(readSession(id)).resolves.toBeNull();
    await expect(readSession('00000000-0000-7000-8000-000000000000')).resolves.toBeNull();
  });

  it('updates payload and expiry in place', async () => {
    const id = await createSession({}, inOneHour());
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await updateSession(id, { userId: null, n: 2 }, later);

    const row = await readSession(id);
    expect(row?.data).toEqual({ userId: null, n: 2 });
    expect(row?.expiresAt.getTime()).toBe(later.getTime());
  });

  it('deletes idempotently and purges expired rows', async () => {
    const live = await createSession({}, inOneHour());
    const dead = await createSession({}, oneHourAgo());

    await deleteSession(live);
    await expect(deleteSession(live)).resolves.toBeUndefined();
    await expect(deleteExpiredSessions()).resolves.toBe(1);
    await expect(prisma.session.count()).resolves.toBe(0);
    expect(dead).toBeTypeOf('string');
  });

  it('cascades when the user is deleted', async () => {
    const user = await upsertUserFromGithub({
      githubId: 2n,
      githubLogin: 'two',
      name: null,
      avatarUrl: null,
    });
    await createSession({ userId: user.id }, inOneHour());
    await prisma.user.delete({ where: { id: user.id } });
    await expect(prisma.session.count()).resolves.toBe(0);
  });
});
