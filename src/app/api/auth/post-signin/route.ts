import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/log';
import { pbServer } from '@/lib/pb/client';
import { withAdminRetry } from '@/lib/pb/admin';
import { GH_TOKEN_COOKIE, type UserRecord } from '@/lib/pb/types';

/**
 * POST /api/auth/post-signin
 *
 * Called by the browser immediately after `pb.collection('users')
 * .authWithOAuth2(...)` resolves. Two jobs:
 *
 *   1. Persist the GitHub OAuth `meta.accessToken` in an HttpOnly cookie.
 *      The token is needed server-side by the runner (Phase 4) and
 *      `/api/github/*` proxy routes; PB itself doesn't store it.
 *   2. Backfill the `github_login` (and `name` / `avatar`) on the user
 *      record from the OAuth `meta`. PB's GitHub provider doesn't auto-map
 *      these fields, so we set them ourselves on every sign-in (cheap,
 *      keeps display fields fresh if the user renames on GitHub).
 *
 * The request must be authenticated — i.e. the browser already wrote the
 * `pb_auth` cookie via `pbBrowser()` before this fetch fires. We verify
 * that here and bail with 401 if not.
 *
 * Returns 204 on success. On allowlist denial (login set but not in the
 * table), still returns 204 — the next navigation hits `proxy.ts` which
 * sees the github_login → not-allowed → /denied. We don't gate here so the
 * cookie write is decoupled from the allowlist policy.
 */
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  accessToken: z.string().min(1),
});

interface GithubViewer {
  login?: string | null;
  name?: string | null;
}

async function verifyGithubToken(accessToken: string, signal: AbortSignal): Promise<GithubViewer> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'enhanced-review/0.1',
    },
    signal,
  });

  if (!res.ok) {
    throw new Error(`GitHub /user returned ${res.status.toString()}`);
  }

  const viewer = (await res.json()) as GithubViewer;
  if (!viewer.login || viewer.login.length > 100) {
    throw new Error('GitHub /user did not return a valid login');
  }
  return viewer;
}

export async function POST(request: NextRequest) {
  // 1. Verify the browser is authenticated against PB.
  const pb = await pbServer();
  if (!pb.authStore.isValid) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }
  const user = pb.authStore.record as UserRecord | null;
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  // 2. Parse + validate body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { accessToken } = parsed.data;

  let viewer: GithubViewer;
  try {
    viewer = await verifyGithubToken(accessToken, request.signal);
  } catch (err) {
    logger.warn({ err, user_id: user.id }, '[auth/post-signin] GitHub token verification failed');
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
      { status: 401 },
    );
  }

  const githubLogin = viewer.login!;
  const name = typeof viewer.name === 'string' ? viewer.name : undefined;

  if (user.github_login && user.github_login !== githubLogin) {
    logger.warn(
      { user_id: user.id, existing_login: user.github_login, verified_login: githubLogin },
      '[auth/post-signin] verified GitHub login does not match existing user login',
    );
    return NextResponse.json(
      {
        reason: 'github_identity_mismatch',
        message: 'GitHub account does not match this session.',
      },
      { status: 409 },
    );
  }

  // 3. Backfill the user record. Admin client because the user can't
  // update their own `github_login` (rule would need to be
  // `@request.auth.id = id`, but a malicious caller could set a different
  // login to bypass allowlist by impersonating another GitHub account).
  // PB's GitHub OAuth provider auto-downloads the avatar into the `avatar`
  // file field on first sign-in, so we don't persist the URL ourselves.
  try {
    await withAdminRetry((admin) =>
      admin.collection('users').update(user.id, {
        github_login: githubLogin,
        ...(name ? { name } : {}),
      }),
    );
  } catch (err) {
    logger.error({ err, user_id: user.id }, '[auth/post-signin] user update failed');
    // Don't fail the whole request — the cookie is still useful and the
    // user can re-link to retry. github_login backfill failure shows up as
    // a /denied redirect on next navigation, which is acceptable.
  }

  // 4. Set the GitHub access-token cookie. HttpOnly so XSS can't read it;
  // `Secure` only in HTTPS contexts (dev runs on http://). `maxAge` so the
  // cookie survives browser restarts — without it, closing the browser
  // forces a re-OAuth even though the PB session is still valid.
  const res = new NextResponse(null, { status: 204 });
  const isHttps = new URL(request.url).protocol === 'https:';
  res.cookies.set(GH_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
  return res;
}
