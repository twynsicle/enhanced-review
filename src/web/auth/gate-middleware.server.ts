import { redirect, type MiddlewareFunction, type RouterContextProvider } from 'react-router';
import { logger } from '@/common/logger';
import { isAllowed } from '@/domain/auth/allowlist';
import { sessionContext, userContext } from './context.server';
import { clearGithubTokenHeader } from './cookies.server';
import { destroySession } from './session.server';

/**
 * Set-Cookie headers that end the current session (deleting its row) and drop
 * the GitHub token. Also clears the context so the root middleware does not
 * try to roll a session that no longer exists. Used by the gate and by
 * `/auth/logout`.
 */
export async function signOutHeaders(context: Readonly<RouterContextProvider>): Promise<Headers> {
  const headers = new Headers();
  const session = context.get(sessionContext);
  headers.append('Set-Cookie', await destroySession(session?.id ?? null));
  headers.append('Set-Cookie', await clearGithubTokenHeader());
  context.set(sessionContext, null);
  context.set(userContext, null);
  return headers;
}

/**
 * Layout middleware for every protected route (phase-2-plan P2-D5): requires
 * a signed-in user whose GitHub login is in `allowed_users`. Anything else is
 * signed out and redirected — `/login` when there was no session, `/denied`
 * when there was one but the login is not allowed (same UX as before).
 */
export const allowlistGate: MiddlewareFunction<Response> = async ({ context }, next) => {
  const user = context.get(userContext);
  if (!user) {
    return redirect('/login', { headers: await signOutHeaders(context) });
  }
  if (!(await isAllowed(user.githubLogin))) {
    logger.warn(
      { user_id: user.id, github_login: user.githubLogin },
      'denied: github login not in allowed_users',
    );
    return redirect('/denied', { headers: await signOutHeaders(context) });
  }
  return next();
};
