import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { accounts } from '@/lib/db/schema';

/**
 * Thrown when the GitHub access token isn't available. Callers translate
 * this into a redirect to `/relink`.
 */
export class MissingProviderTokenError extends Error {
  constructor(message = 'No GitHub access token available for this user') {
    super(message);
    this.name = 'MissingProviderTokenError';
  }
}

/**
 * Read the user's GitHub OAuth access token from the Auth.js `accounts`
 * table. Server-only, never exposed to the client.
 *
 * Returns `null` when no row exists (e.g. the user signed in but the
 * provider didn't return an access token for some reason). Callers that
 * need a hard error should throw `MissingProviderTokenError`.
 *
 * GitHub OAuth Apps issue non-expiring tokens, so no refresh logic is
 * needed. If we ever migrate to GitHub Apps, see the Auth.js refresh-token
 * recipe.
 */
export async function getGithubTokenFor(userId: string): Promise<string | null> {
  const rows = await db
    .select({ token: accounts.access_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'github')))
    .limit(1);
  return rows[0]?.token ?? null;
}
