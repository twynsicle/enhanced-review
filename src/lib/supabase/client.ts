import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for use in Client Components.
 *
 * Uses the public anon key. Reads/writes the auth session cookie via the
 * browser; the matching server-side reads happen in `./server.ts`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
