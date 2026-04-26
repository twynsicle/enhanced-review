import 'server-only';
import PocketBase from 'pocketbase';
import { cookies } from 'next/headers';
import { PB_AUTH_COOKIE } from './types';

/**
 * Per-request PocketBase client for Server Components, Route Handlers, and
 * Server Actions. Reads the `pb_auth` cookie via Next 16's async `cookies()`
 * and hydrates the auth store.
 *
 * Cookie writes (e.g. after `authRefresh`) go through the same Next API.
 * Server Components can't set cookies — Next throws — so we swallow the
 * error there; middleware (`proxy.ts`) handles the refresh path properly.
 *
 * **Server-only.** The browser equivalent is `pbBrowser()` in
 * `./browser.ts`; do not import this module from a client component or
 * the bundler will choke on `next/headers`.
 */

function pbUrl(): string {
  const url = process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!url) {
    throw new Error('Missing POCKETBASE_URL (or NEXT_PUBLIC_POCKETBASE_URL fallback)');
  }
  return url;
}

export async function pbServer(): Promise<PocketBase> {
  const pb = new PocketBase(pbUrl());
  const jar = await cookies();

  const raw = jar.get(PB_AUTH_COOKIE)?.value;
  if (raw) {
    pb.authStore.loadFromCookie(`${PB_AUTH_COOKIE}=${raw}`, PB_AUTH_COOKIE);
  }

  pb.authStore.onChange(() => {
    try {
      const cookieStr = pb.authStore.exportToCookie(
        { httpOnly: false, sameSite: 'Lax', path: '/' },
        PB_AUTH_COOKIE,
      );
      const value = parseCookieValue(cookieStr);
      if (value === null) {
        jar.delete(PB_AUTH_COOKIE);
      } else {
        jar.set(PB_AUTH_COOKIE, value, { httpOnly: false, sameSite: 'lax', path: '/' });
      }
    } catch {
      // Server Component context — cookies() is read-only here. The
      // browser already wrote the cookie via pbBrowser().onChange, and the
      // middleware refresh path (proxy.ts) re-runs in a writable context.
    }
  });

  return pb;
}

/**
 * Pull the value out of a Set-Cookie-style header string.
 * Input:  `pb_auth=eyJ0b2tlbiI6Imh...; Path=/; SameSite=Lax`
 * Output: `eyJ0b2tlbiI6Imh...`
 * Returns null when the cookie value is empty / cleared (Max-Age=0 path).
 */
function parseCookieValue(cookieStr: string): string | null {
  const head = cookieStr.split(';', 1)[0] ?? '';
  const eq = head.indexOf('=');
  if (eq < 0) return null;
  const value = head.slice(eq + 1).trim();
  return value.length > 0 ? value : null;
}
