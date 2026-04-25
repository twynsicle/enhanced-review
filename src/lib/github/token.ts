import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Thrown when the Supabase session has no GitHub `provider_token`. Happens
 * if the user signed in before we requested the `repo` scope, or if their
 * session was created via a non-GitHub provider. Callers translate this
 * into a redirect to `/relink`.
 */
export class MissingProviderTokenError extends Error {
  constructor(message = 'No GitHub provider token on this Supabase session') {
    super(message);
    this.name = 'MissingProviderTokenError';
  }
}

/**
 * Read the user's GitHub OAuth `provider_token` off the Supabase session.
 *
 * The token is stored on the session at sign-in time and persists in the
 * session cookie until the user signs out. We do **not** attempt to refresh
 * it: GitHub OAuth Apps don't issue refresh tokens by default and Supabase's
 * `refreshSession()` only mints a new Supabase JWT — not a new
 * `provider_token`. If the token is rejected by GitHub, callers redirect
 * the user to `/relink` to re-run the OAuth flow.
 */
export async function getGithubToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.provider_token;
  if (typeof token !== 'string' || token.length === 0) {
    throw new MissingProviderTokenError();
  }
  return token;
}
