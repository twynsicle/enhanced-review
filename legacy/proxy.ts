import PocketBase, { getTokenPayload } from 'pocketbase';
import { NextResponse, type NextRequest } from 'next/server';
import { getGithubLogin, isAllowed } from '@/lib/auth/allowlist';
import { pbAdmin } from '@/lib/pb/admin';
import { GH_TOKEN_COOKIE, PB_AUTH_COOKIE } from '@/lib/pb/types';
import type { UserRecord } from '@/lib/pb/types';

/**
 * Roll the PB session cookie when the JWT is past half its lifetime. Without
 * this the user has to re-OAuth as soon as the original token expires (PB
 * default: 7 days). With it, an active user's session extends indefinitely
 * — every visit past the halfway mark mints a fresh 7-day token.
 */
type RefreshedCookie = { value: string; expires: Date };

async function rollSessionIfStale(pb: PocketBase): Promise<RefreshedCookie | null> {
  const payload = getTokenPayload(pb.authStore.token);
  const exp = typeof payload?.exp === 'number' ? payload.exp : 0;
  const iat = typeof payload?.iat === 'number' ? payload.iat : 0;
  if (!exp || !iat || exp <= iat) return null;

  const now = Math.floor(Date.now() / 1000);
  const halfway = iat + (exp - iat) / 2;
  if (now < halfway) return null;

  try {
    await pb.collection('users').authRefresh();
  } catch (err) {
    console.warn('[proxy] auth refresh failed; keeping current token', err);
    return null;
  }

  const cookieStr = pb.authStore.exportToCookie(
    { httpOnly: false, sameSite: 'Lax', path: '/' },
    PB_AUTH_COOKIE,
  );
  const value = parseCookieValue(cookieStr);
  if (!value) return null;

  const newPayload = getTokenPayload(pb.authStore.token);
  const newExp = typeof newPayload?.exp === 'number' ? newPayload.exp : 0;
  if (!newExp) return null;

  return { value, expires: new Date(newExp * 1000) };
}

function parseCookieValue(cookieStr: string): string | null {
  const head = cookieStr.split(';', 1)[0] ?? '';
  const eq = head.indexOf('=');
  if (eq < 0) return null;
  const value = head.slice(eq + 1).trim();
  return value.length > 0 ? value : null;
}

function applyRefreshed(
  res: NextResponse,
  refreshed: RefreshedCookie | null,
  request: NextRequest,
): NextResponse {
  if (!refreshed) return res;
  res.cookies.set(PB_AUTH_COOKIE, refreshed.value, {
    httpOnly: false,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    expires: refreshed.expires,
  });
  return res;
}

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

  const refreshed = pb.authStore.isValid ? await rollSessionIfStale(pb) : null;
  const user = pb.authStore.isValid ? (pb.authStore.record as UserRecord | null) : null;

  // /login: allow unauthed; bounce authed+allowed users home. We can't
  // safely redirect an authed-but-not-yet-allowlisted user from /login —
  // they might just have signed in for the first time and the post-signin
  // handler hasn't populated github_login yet.
  if (pathname === '/login') {
    if (user) {
      const githubLogin = getGithubLogin(user);
      if (githubLogin && (await isAllowed(await pbAdmin(), githubLogin))) {
        return applyRefreshed(redirect(request, '/'), refreshed, request);
      }
    }
    return applyRefreshed(NextResponse.next(), refreshed, request);
  }

  // Everything else: authentication required.
  if (!user) {
    return clearAuthAndRedirect(request, '/login');
  }

  // Allowlist gate.
  const githubLogin = getGithubLogin(user);
  if (!githubLogin) {
    console.warn(
      `[proxy] denying ${pathname}: user ${user.id} has no github_login set (post-signin may not have run)`,
    );
    return clearAuthAndRedirect(request, '/denied');
  }
  if (!(await isAllowed(await pbAdmin(), githubLogin))) {
    console.warn(
      `[proxy] denying ${pathname}: github_login "${githubLogin}" (user ${user.id}) not found in allowed_users`,
    );
    return clearAuthAndRedirect(request, '/denied');
  }

  return applyRefreshed(NextResponse.next(), refreshed, request);
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
