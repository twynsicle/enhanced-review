import { redirect } from 'react-router';
import { signOutHeaders } from '@/web/auth/gate-middleware.server';
import type { Route } from './+types/auth.logout';

/** POST /auth/logout — deletes the session row, clears both cookies. */
export async function action({ context }: Route.ActionArgs) {
  return redirect('/login', { headers: await signOutHeaders(context) });
}

/** Sign-out must be a POST so a stray link cannot log someone out. */
export function loader() {
  throw new Response('Method Not Allowed', { status: 405 });
}
