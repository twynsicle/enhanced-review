import 'server-only';
import { cookies } from 'next/headers';
import { pbServer } from './client';
import { GH_TOKEN_COOKIE, type UserRecord } from './types';

/**
 * Server-side helper: returns the signed-in user record (typed) or `null`.
 * Use in Server Components and Route Handlers when you only need the
 * record, not the full PB client.
 */
export async function getCurrentUser(): Promise<UserRecord | null> {
  const pb = await pbServer();
  if (!pb.authStore.isValid) return null;
  const record = pb.authStore.record;
  return record ? (record as UserRecord) : null;
}

/**
 * Reads the GitHub provider access token from the HttpOnly cookie set by
 * `/api/auth/post-signin`. Returns `null` when missing — callers translate
 * that into a redirect to `/relink`.
 */
export async function readGithubTokenCookie(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(GH_TOKEN_COOKIE)?.value;
  return v && v.length > 0 ? v : null;
}
