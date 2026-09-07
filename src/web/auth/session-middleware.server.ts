import type { MiddlewareFunction } from 'react-router';
import { findUserById } from '@/db/users';
import { toSessionUser } from '@/domain/auth/sign-in';
import { sessionContext, userContext } from './context.server';
import { loadSession, rollSession, shouldRoll } from './session.server';

/**
 * Root middleware: resolves the session + user for every request and exposes
 * them via route context. Never redirects — that is the gate's job
 * (phase-2-plan P2-D5). After the response is produced, rolls a session that
 * is past half-life unless something downstream destroyed it.
 */
export const sessionMiddleware: MiddlewareFunction<Response> = async (
  { request, context },
  next,
) => {
  const session = await loadSession(request);
  const userRow = session?.userId ? await findUserById(session.userId) : null;
  context.set(sessionContext, session);
  context.set(userContext, userRow ? toSessionUser(userRow) : null);

  const response = await next();

  const live = context.get(sessionContext);
  if (live && shouldRoll(live.expiresAt)) {
    response.headers.append('Set-Cookie', await rollSession(live));
  }
  return response;
};
