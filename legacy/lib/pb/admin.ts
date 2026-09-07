import 'server-only';
import PocketBase from 'pocketbase';

/**
 * Server-only PocketBase client authenticated as a PB superuser. Bypasses
 * collection rules — used for allowlist lookups (rules deny everyone else)
 * and for server-side writes that need to skip ownership rules (e.g.
 * populating `github_login` on a freshly-created user record after OAuth).
 *
 * Token is cached at module scope and reused. PB superuser tokens are
 * long-lived; on a `401` we transparently re-auth and retry once. NEVER
 * import this module from a client component.
 */

let cached: { pb: PocketBase; token: string } | null = null;

function url(): string {
  const v = process.env.POCKETBASE_URL ?? process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!v) throw new Error('Missing POCKETBASE_URL');
  return v;
}

function creds(): { email: string; password: string } {
  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing POCKETBASE_ADMIN_EMAIL / POCKETBASE_ADMIN_PASSWORD');
  }
  return { email, password };
}

async function login(): Promise<PocketBase> {
  const pb = new PocketBase(url());
  pb.autoCancellation(false);
  const { email, password } = creds();
  await pb.collection('_superusers').authWithPassword(email, password);
  cached = { pb, token: pb.authStore.token };
  return pb;
}

export async function pbAdmin(): Promise<PocketBase> {
  if (cached && cached.pb.authStore.isValid) {
    return cached.pb;
  }
  return login();
}

/**
 * Run `fn` against the admin client; on a 401 (cached token went stale —
 * superuser was deleted, env password rotated, etc.) re-auth and retry once.
 */
export async function withAdminRetry<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  const pb = await pbAdmin();
  try {
    return await fn(pb);
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      cached = null;
      const fresh = await pbAdmin();
      return fn(fresh);
    }
    throw err;
  }
}

function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: unknown }).status;
  return status === 401 || status === 403;
}
