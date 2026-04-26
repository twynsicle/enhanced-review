import PocketBase from 'pocketbase';
import { PB_AUTH_COOKIE } from './types';

/**
 * Browser-side PocketBase client. Singleton: PB's default `LocalAuthStore`
 * persists to `localStorage`, so reusing one client keeps both tabs and
 * realtime subscriptions in sync.
 *
 * Mirrors the auth state to a non-HttpOnly `pb_auth` cookie on every change
 * so server components / route handlers / middleware can read the session
 * via `pbServer()`. The PB SDK doesn't write the cookie itself in the
 * browser — only in `getServerSideProps`-style server flows — so this is
 * the bridge for App Router.
 *
 * **Browser-only.** Don't import this from server modules — it has no
 * `next/headers` dependency, and importing it from a server module that's
 * also imported in a client component would still bundle correctly, but
 * the singleton wouldn't be useful there. Use `pbServer()` instead.
 */

let browserSingleton: PocketBase | null = null;

function pbUrl(): string {
  const url = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!url) throw new Error('Missing NEXT_PUBLIC_POCKETBASE_URL');
  return url;
}

export function pbBrowser(): PocketBase {
  if (typeof window === 'undefined') {
    throw new Error('pbBrowser() called on the server — use pbServer() instead');
  }
  if (browserSingleton) return browserSingleton;

  const pb = new PocketBase(pbUrl());

  const syncCookie = () => {
    const cookieStr = pb.authStore.exportToCookie(
      {
        httpOnly: false,
        secure: window.location.protocol === 'https:',
        sameSite: 'Lax',
        path: '/',
      },
      PB_AUTH_COOKIE,
    );
    document.cookie = cookieStr;
  };

  pb.authStore.onChange(syncCookie);
  syncCookie();

  browserSingleton = pb;
  return pb;
}
