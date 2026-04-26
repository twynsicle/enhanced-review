import PocketBase from 'pocketbase';
import { NextResponse, type NextRequest } from 'next/server';
import { getGithubLogin, isAllowed } from '@/lib/auth/allowlist';
import { pbAdmin } from '@/lib/pb/admin';
import { GH_TOKEN_COOKIE, PB_AUTH_COOKIE } from '@/lib/pb/types';
import type { UserRecord } from '@/lib/pb/types';

/**
 * Next 16's `proxy.ts` (formerly `middleware.ts`). Runs on every matched
 * request before route resolution.
 *
 * Two responsibilities:
 *
 *   1. Hydrate the PocketBase auth state from the `pb_auth` cookie so the
 *      gate below sees the same session a Server Component would.
 *   2. Gate access:
 *        - `/api/auth/*` — always allowed (post-signin / sign-out need to
 *          run with whatever auth state the cookie has, no allowlist gate)
 *        - `/api/health`  — public ops endpoint, no per-user data
 *        - `/login`       — allowed; redirect away if already authed AND
 *          allowed (otherwise the user could sign in repeatedly with no
 *          way out)
 *        - `/denied`      — allowed (users we just signed out land here)
 *        - everything else: must be authed AND in `allowed_users`. Otherwise
 *          clear the auth cookies and redirect to `/denied` (or `/login`
 *          when there was no session to begin with).
 *
 * Next 16 `proxy` runs on the nodejs runtime, so the PB superuser admin
 * client used for the allowlist lookup is fine here.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public paths first — skip auth work entirely.
  if (pathname.startsWith('/api/auth')) return NextResponse.next();
  if (pathname === '/api/health') return NextResponse.next();
  if (pathname === '/denied') return NextResponse.next();

  // Hydrate PB auth from the request cookie.
  const pbUrl = process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) {
    // Misconfigured env — fail closed.
    console.error('[proxy] POCKETBASE_URL not set; denying all requests');
    return clearAuthAndRedirect(request, '/denied');
  }

  const pb = new PocketBase(pbUrl);
  const cookieValue = request.cookies.get(PB_AUTH_COOKIE)?.value;
  if (cookieValue) {
    pb.authStore.loadFromCookie(`${PB_AUTH_COOKIE}=${cookieValue}`, PB_AUTH_COOKIE);
  }

  const user = pb.authStore.isValid ? (pb.authStore.record as UserRecord | null) : null;

  // /login: allow unauthed; bounce authed+allowed users home. We can't
  // safely redirect an authed-but-not-yet-allowlisted user from /login —
  // they might just have signed in for the first time and the post-signin
  // handler hasn't populated github_login yet.
  if (pathname === '/login') {
    if (user) {
      const githubLogin = getGithubLogin(user);
      if (githubLogin && (await isAllowed(await pbAdmin(), githubLogin))) {
        return redirect(request, '/');
      }
    }
    return NextResponse.next();
  }

  // Everything else: authentication required.
  if (!user) {
    return clearAuthAndRedirect(request, '/login');
  }

  // Allowlist gate.
  const githubLogin = getGithubLogin(user);
  if (!githubLogin) {
    return clearAuthAndRedirect(request, '/denied');
  }
  if (!(await isAllowed(await pbAdmin(), githubLogin))) {
    return clearAuthAndRedirect(request, '/denied');
  }

  return NextResponse.next();
}

function redirect(request: NextRequest, path: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = '';
  return NextResponse.redirect(url);
}

/**
 * Drop both auth cookies and redirect. PB's `pb_auth` is the session;
 * `gh_access_token` is the GitHub provider token persisted alongside it.
 * Clearing one without the other would leave a token attached to no
 * session.
 */
function clearAuthAndRedirect(request: NextRequest, path: string): NextResponse {
  const res = redirect(request, path);
  res.cookies.delete(PB_AUTH_COOKIE);
  res.cookies.delete(GH_TOKEN_COOKIE);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
