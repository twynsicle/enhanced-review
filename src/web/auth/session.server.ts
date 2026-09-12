import { createSessionStorage } from 'react-router';
import { createSession, deleteSession, readSession, updateSession } from '@/db/sessions';
import { SESSION_MAX_AGE_SEC, sessionCookie } from './cookies.server';

/**
 * DB-backed sessions. React Router's `createSessionStorage` handles id
 * minting and cookie commit on sign-in; the per-request path (root
 * middleware) reads the row directly so it can see `expiresAt` and roll the
 * session past half-life.
 */
export interface SessionPayload {
  userId: string;
}

export interface LoadedSession {
  id: string;
  userId: string | null;
  expiresAt: Date;
  data: Record<string, unknown>;
}

function expiryFrom(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_MAX_AGE_SEC * 1000);
}

export const sessionStorage = createSessionStorage<SessionPayload>({
  cookie: sessionCookie,
  createData: (data, expires) => createSession(data, expires ?? expiryFrom()),
  readData: async (id) => {
    const row = await readSession(id);
    return row ? (row.data as Partial<SessionPayload>) : null;
  },
  updateData: (id, data, expires) => updateSession(id, data, expires ?? expiryFrom()),
  deleteData: (id) => deleteSession(id),
});

/** The signed session id from the request cookie, or null. */
export async function readSessionId(request: Request): Promise<string | null> {
  const value: unknown = await sessionCookie.parse(request.headers.get('cookie'));
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The live (unexpired) session row behind the request, or null. */
export async function loadSession(request: Request): Promise<LoadedSession | null> {
  const id = await readSessionId(request);
  if (!id) return null;
  const row = await readSession(id);
  return row ? { id: row.id, userId: row.userId, expiresAt: row.expiresAt, data: row.data } : null;
}

/**
 * True once less than half of the session lifetime remains — the point at
 * which a request extends the session rather than let an active visitor be
 * signed out mid-visit. Half is what keeps the write rare: rolling resets the
 * expiry to a full lifetime, so no visitor costs more than one extra row
 * update per half-lifetime however hard they browse.
 */
export function shouldRoll(
  expiresAt: Date,
  now = new Date(),
  maxAgeSec = SESSION_MAX_AGE_SEC,
): boolean {
  return expiresAt.getTime() - now.getTime() < (maxAgeSec * 1000) / 2;
}

/** Extends the row to a full lifetime again; returns the refreshed Set-Cookie. */
export async function rollSession(session: LoadedSession, now = new Date()): Promise<string> {
  await updateSession(session.id, session.data, expiryFrom(now));
  return sessionCookie.serialize(session.id);
}

/** Mints a session for `userId`; returns its Set-Cookie header value. */
export async function createUserSession(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set('userId', userId);
  return sessionStorage.commitSession(session);
}

/** Deletes the row (if any) and returns the Set-Cookie that clears the cookie. */
export async function destroySession(id: string | null): Promise<string> {
  if (id) await deleteSession(id);
  return sessionCookie.serialize('', { maxAge: 0, expires: new Date(0) });
}
