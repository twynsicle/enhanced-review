import { redirect, type MiddlewareFunction, type RouterContextProvider } from 'react-router';
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
 * Layout middleware for every protected route: requires a signed-in user.
 * Anyone else is signed out — the session row and both cookies go — and
 * redirected to `/login`.
 *
 * This once also required the user's GitHub login to be in an `allowed_users`
 * table, sending everyone else to `/denied`. Both are gone: signing in with
 * GitHub is the only condition now, so whatever fronts the deployment is the
 * access control.
 */
export const requireUser: MiddlewareFunction<Response> = async ({ context }, next) => {
  const user = context.get(userContext);
  if (!user) {
    return redirect('/login', { headers: await signOutHeaders(context) });
  }
  return next();
};
