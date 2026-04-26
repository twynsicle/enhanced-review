import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Extract the GitHub login (username) from a Supabase auth user.
 *
 * gotrue's GitHub provider stores it on `user_metadata.user_name`. Other keys
 * (`preferred_username`, `name`) are populated too but `user_name` is the
 * canonical login slug we joined on in the allowlist.
 *
 * Returns `null` if the field is missing or not a string — defensive against
 * non-GitHub identity providers being added later.
 */
export function getGithubLogin(user: User): string | null {
  const meta = user.user_metadata as Record<string, unknown> | null | undefined;
  const login = meta?.user_name;
  return typeof login === 'string' && login.length > 0 ? login : null;
}

/**
 * True iff `githubLogin` is present in `public.allowed_users`.
 *
 * Must be called with a service-role client (RLS would otherwise hide the
 * table from authenticated users). On query error we fail closed (return
 * false) — better to deny a real user than to let a denied user through.
 */
export async function isAllowed(admin: SupabaseClient, githubLogin: string): Promise<boolean> {
  const { data, error } = await admin
    .from('allowed_users')
    .select('github_login')
    .eq('github_login', githubLogin)
    .maybeSingle();

  if (error) {
    // Imported from proxy.ts (middleware) — keep console.error to avoid
    // pulling pino into the middleware bundle.
    console.error('[allowlist] lookup failed', error);
    return false;
  }
  return data !== null;
}
