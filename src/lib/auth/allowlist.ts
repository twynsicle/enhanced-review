import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { allowedUsers } from '@/lib/db/schema';

/**
 * True iff `githubLogin` is present in the `allowed_users` table.
 *
 * Called from two places:
 *   1. The Auth.js `signIn` callback (`src/lib/auth/auth.ts`) — refuses the
 *      OAuth handshake before a session is created.
 *   2. The `proxy.ts` middleware — defense-in-depth, every request.
 *
 * On query error we fail closed (return false) — better to deny a real user
 * than to let a denied user through.
 */
export async function isAllowed(githubLogin: string): Promise<boolean> {
  if (!githubLogin) return false;
  try {
    const rows = await db
      .select({ id: allowedUsers.id })
      .from(allowedUsers)
      .where(eq(allowedUsers.githubLogin, githubLogin))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.error('[allowlist] lookup failed', err);
    return false;
  }
}
