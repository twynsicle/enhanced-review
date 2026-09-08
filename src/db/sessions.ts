import { prisma } from './client.ts';

/**
 * Backing store for React Router's `createSessionStorage` (src/web/auth).
 * `data` is the opaque session payload; `userId` is lifted out of it so
 * sessions cascade when a user row is deleted and can be listed per user. The
 * GitHub token never goes in here.
 */
export type SessionData = Record<string, unknown>;

export interface SessionRow {
  id: string;
  userId: string | null;
  data: SessionData;
  expiresAt: Date;
}

function userIdOf(data: SessionData): string | null {
  const value = data['userId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Prisma's Json column accepts any JSON-serialisable value; the session
// payload is plain data so the cast is safe.
function toJson(data: SessionData) {
  return data as Parameters<typeof prisma.session.create>[0]['data']['data'];
}

export async function createSession(data: SessionData, expiresAt: Date): Promise<string> {
  const row = await prisma.session.create({
    data: { userId: userIdOf(data), data: toJson(data), expiresAt },
    select: { id: true },
  });
  return row.id;
}

/** Null when missing or already expired. */
export async function readSession(id: string): Promise<SessionRow | null> {
  const row = await prisma.session.findUnique({
    where: { id },
    select: { id: true, userId: true, data: true, expiresAt: true },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  return { ...row, data: row.data as SessionData };
}

export async function updateSession(id: string, data: SessionData, expiresAt: Date): Promise<void> {
  await prisma.session.update({
    where: { id },
    data: { userId: userIdOf(data), data: toJson(data), expiresAt },
  });
}

export async function deleteSession(id: string): Promise<void> {
  // deleteMany so a stale cookie id (row already gone) is a no-op, not a P2025.
  await prisma.session.deleteMany({ where: { id } });
}

/** Removes rows whose `expiresAt` has passed; returns how many. */
export async function deleteExpiredSessions(now = new Date()): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
