import 'server-only';
import { NextResponse } from 'next/server';
import { GH_TOKEN_COOKIE, PB_AUTH_COOKIE } from '@/lib/pb/types';

/**
 * POST /api/auth/sign-out
 *
 * Clears both auth cookies. The browser also runs `pb.authStore.clear()`
 * via `pbBrowser()` to wipe localStorage; that fires `onChange` which
 * writes an expiring `pb_auth` cookie too — this endpoint is the
 * server-side belt to that browser-side suspenders, and importantly clears
 * the HttpOnly `gh_access_token` which the browser can't touch.
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.delete(PB_AUTH_COOKIE);
  res.cookies.delete(GH_TOKEN_COOKIE);
  return res;
}
