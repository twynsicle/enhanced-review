import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { isAllowed } from '@/lib/auth/allowlist';

/**
 * Next 16's `proxy.ts` (formerly `middleware.ts`). Runs on every matched
 * request on the Node runtime.
 *
 * Two responsibilities now (PB's session-rolling logic is gone — Auth.js
 * manages its own cookie lifetime):
 *
 *   1. Identify the user via Auth.js's session cookie.
 *   2. Allowlist gate — defense-in-depth on top of the `signIn` callback in
 *      `src/lib/auth/auth.ts`. Catches the case where someone is signed in
 *      but their `allowed_users` row was removed mid-session.
 *
 * Public paths (no auth required):
 *   - `/api/auth/*` — Auth.js routes (sign-in, callback, sign-out, session)
 *   - `/api/health` — public ops endpoint
 *   - `/login` — sign-in page
 *   - `/denied` — landing page for refused users
 */
export const proxy = auth(async (req) => {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/auth')) return NextResponse.next();
  if (pathname === '/api/health') return NextResponse.next();
  if (pathname === '/denied') return NextResponse.next();

  const session = req.auth;

  if (pathname === '/login') {
    if (session?.user?.githubLogin && (await isAllowed(session.user.githubLogin))) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!session?.user) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const githubLogin = session.user.githubLogin;
  if (!githubLogin || !(await isAllowed(githubLogin))) {
    const url = req.nextUrl.clone();
    url.pathname = '/denied';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
