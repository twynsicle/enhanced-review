import { redirect } from 'react-router';
import { authenticator, GITHUB_STRATEGY } from '@/web/auth/authenticator.server';
import type { Route } from './+types/auth.github';

/**
 * POST /auth/github — starts the OAuth redirect flow. `authenticate()` throws
 * the redirect to GitHub (after setting the state cookie); if it ever returns
 * here the user is already signed in, so go home.
 */
export async function action({ request }: Route.ActionArgs) {
  await authenticator.authenticate(GITHUB_STRATEGY, request);
  return redirect('/');
}

/** Sign-in is a POST from the login form; a bare GET just goes to the form. */
export function loader() {
  return redirect('/login');
}
