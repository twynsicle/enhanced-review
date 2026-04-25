import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. **Server-only.** Bypasses Row Level Security.
 *
 * Used to query the `allowed_users` table from the proxy/middleware: that
 * table has RLS enabled with no policies, so anon/authenticated roles cannot
 * see it; only service_role (or direct postgres) can read it.
 *
 * NEVER import this from a Client Component or expose the underlying key in
 * the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env',
    );
  }

  return createClient(url, key, {
    auth: {
      // No session persistence — this client is request-scoped and stateless.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
