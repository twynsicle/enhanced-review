import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getGithubLogin, isAllowed } from '@/lib/auth/allowlist';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Next 16's `proxy.ts` (formerly `middleware.ts`). Runs on every matched
 * request before route resolution.
 *
 * Two responsibilities:
 *
 *   1. Refresh the Supabase auth cookie (the SDK rotates tokens; if we don't
 *      sync them here, server components see a stale session and SSR pages
 *      flicker between logged-in / logged-out).
 *   2. Gate access:
 *        - `/auth/*`  — always allowed (OAuth callback must run pre-session)
 *        - `/login`   — allowed; redirect away if already authed
 *        - `/denied`  — allowed (users we just signed out land here)
 *        - everything else: must be authed AND in `allowed_users`. Otherwise
 *          sign out and redirect to `/denied`.
 *
 * The Next 16 `proxy` runtime is nodejs (edge is not supported), so the
 * service-role admin client used for the allowlist lookup is fine here.
 *
 * IMPORTANT (per Supabase SSR docs): Don't put logic between
 * `createServerClient(...)` and `getUser()`, and propagate `supabaseResponse`
 * cookies onto any redirect we return — otherwise the browser and server
 * sessions can drift.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // OAuth callback must run before any session exists.
  if (pathname.startsWith('/auth')) return supabaseResponse;

  // Public ops endpoint — no per-user data, intentionally pingable
  // without a session.
  if (pathname === '/api/health') return supabaseResponse;

  // /login: allow unauthed; bounce authed users home.
  if (pathname === '/login') {
    if (user) return forwardCookies(supabaseResponse, redirect(request, '/'));
    return supabaseResponse;
  }

  // /denied: anyone (especially users we just signed out) can land here.
  if (pathname === '/denied') return supabaseResponse;

  // Everything else: authentication required.
  if (!user) {
    return forwardCookies(supabaseResponse, redirect(request, '/login'));
  }

  // Allowlist check (server-only, bypasses RLS).
  const githubLogin = getGithubLogin(user);
  if (!githubLogin) {
    await supabase.auth.signOut();
    return forwardCookies(supabaseResponse, redirect(request, '/denied'));
  }

  const admin = createAdminClient();
  if (!(await isAllowed(admin, githubLogin))) {
    await supabase.auth.signOut();
    return forwardCookies(supabaseResponse, redirect(request, '/denied'));
  }

  return supabaseResponse;
}

function redirect(request: NextRequest, path: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = '';
  return NextResponse.redirect(url);
}

/**
 * Copy any cookies the Supabase SDK set during this request onto a redirect
 * response so the session change survives the navigation. Without this,
 * `signOut()` in the proxy is invisible to the browser and the user stays
 * authed.
 */
function forwardCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((c) => to.cookies.set(c));
  return to;
}

export const config = {
  // Run on every path EXCEPT static/Next internals + common static asset
  // extensions. Do NOT exclude /auth — we need cookie sync there too; the
  // proxy body lets /auth/* through after the sync.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
