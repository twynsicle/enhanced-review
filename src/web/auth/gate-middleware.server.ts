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
 * Layout middleware for every protected route (phase-2-plan P2-D5): requires
 * a signed-in user. Anyone else is signed out — the session row and both
 * cookies go — and redirected to `/login`.
 *
 * Until phase-5-plan P5-D3 this also required the user's GitHub login to be
 * in `allowed_users` and sent everyone else to `/denied`. That table and the
 * page are gone: signing in with GitHub is the only condition now.
 */
export const requireUser: MiddlewareFunction<Response> = async ({ context }, next) => {
  const user = context.get(userContext);
  if (!user) {
    return redirect('/login', { headers: await signOutHeaders(context) });
  }
  return next();
};
