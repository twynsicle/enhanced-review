import 'server-only';
import type PocketBase from 'pocketbase';
import type { UserRecord } from '@/lib/pb';

/**
 * Extract the GitHub login from a PB users record. Populated by
 * `/api/auth/post-signin` from the OAuth `meta.username` returned by
 * `authWithOAuth2`. PB's auto-created `username` (e.g. `users123abc`) is
 * NOT the GitHub handle, hence the dedicated field.
 *
 * Returns `null` when the field is missing — happens for records created
 * before the post-signin handler ran, and for any future non-GitHub
 * providers.
 */
export function getGithubLogin(user: UserRecord | null | undefined): string | null {
  if (!user) return null;
  const login = user.github_login;
  return typeof login === 'string' && login.length > 0 ? login : null;
}

/**
 * True iff `githubLogin` is present in the `allowed_users` PB collection.
 *
 * Must be called with a PB superuser client — the collection's list/view
 * rules are `null` (server-only) so any other client gets nothing back.
 * On query error we fail closed (return false) — better to deny a real
 * user than to let a denied user through.
 */
export async function isAllowed(admin: PocketBase, githubLogin: string): Promise<boolean> {
  try {
    await admin
      .collection('allowed_users')
      .getFirstListItem(`github_login = "${escape(githubLogin)}"`);
    return true;
  } catch (err: unknown) {
    if (isNotFound(err)) return false;
    // Unexpected — log to console (this runs in middleware where we
    // intentionally avoid pulling pino into the bundle).
    console.error('[allowlist] lookup failed', err);
    return false;
  }
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { status?: unknown }).status === 404;
}

/**
 * Escape a value for inclusion in a PB filter string. PB filters are
 * shell-like; double quotes inside a `"..."` literal need escaping. Backs
 * out anything weirder than that — GitHub logins are alphanumeric+hyphen
 * so this is mostly defense-in-depth against future input.
 */
function escape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
