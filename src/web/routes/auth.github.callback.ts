import { redirect } from 'react-router';
import { logger } from '@/common/logger';
import { deleteExpiredSessions } from '@/db/sessions';
import { authenticator, GITHUB_STRATEGY, type GithubSignIn } from '@/web/auth/authenticator.server';
import { sessionContext } from '@/web/auth/context.server';
import { setGithubTokenHeader } from '@/web/auth/cookies.server';
import { createUserSession, destroySession, readSessionId } from '@/web/auth/session.server';
import type { Route } from './+types/auth.github.callback';

/**
 * GET /auth/github/callback — GitHub sends the user back here. Exchange the
 * code, upsert the user (verify callback), then respond with two cookies: the
 * new session id and the GitHub token. Any failure (denied consent, state
 * mismatch, GitHub API error) lands on /login with a banner instead of an
 * error page.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  let signIn: GithubSignIn;
  try {
    signIn = await authenticator.authenticate(GITHUB_STRATEGY, request);
  } catch (err) {
    if (err instanceof Response) throw err;
    logger.warn({ err }, 'github sign-in failed');
    return redirect('/login?error=oauth');
  }

  // Re-link replaces the previous session rather than leaving an orphan row;
  // expired rows from anyone are swept while we are here. Clearing
  // `sessionContext` is part of destroying a session: the root middleware
  // still holds the loaded row and would otherwise try to roll a session that
  // no longer exists, throwing after the response was already produced.
  await destroySession(await readSessionId(request));
  context.set(sessionContext, null);
  await deleteExpiredSessions();

  const headers = new Headers();
  headers.append('Set-Cookie', await createUserSession(signIn.user.id));
  headers.append('Set-Cookie', await setGithubTokenHeader(signIn.accessToken));
  return redirect('/', { headers });
}
