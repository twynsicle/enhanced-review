import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for use in Server Components, Route Handlers, and
 * Server Actions.
 *
 * Reads/writes the session cookie via Next.js's async `cookies()` API
 * (Next 16 made it async-only). Setting cookies from a Server Component
 * throws — that's expected; the proxy.ts session refresh covers that case,
 * so we swallow the error.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — ignored. Session refresh
            // happens in proxy.ts.
          }
        },
      },
    },
  );
}
