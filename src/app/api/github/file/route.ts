import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MissingProviderTokenError, getGithubToken } from '@/lib/github/token';
import { getFileAtRef } from '@/lib/github/view-time';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/github/file?owner=...&repo=...&path=...&ref=...
 *
 * Server-side proxy that the Phase 6 `InlineDiffChunk` calls to load
 * base/head file blobs. Token never reaches the browser; the route
 * reads the *viewer's* GitHub OAuth provider_token off the Supabase
 * session and forwards it to GitHub's contents API.
 *
 * Response shape mirrors the {@link import('@/lib/github/view-time').ViewTimeResult}
 * discriminated union except for hard auth failures, which return 401
 * with a `github_token_invalid` reason so `lib/github/fetcher.ts` can
 * trigger the `/relink` redirect.
 *
 * 200 + `{ ok: true, content, language, lineCount }` — file fetched.
 * 200 + `{ ok: false, error: 'no-access' | 'not-found' | 'too-large' |
 *        'rate-limited' | 'unknown' }` — handled gracefully by the
 *        component (renders a "no access" body etc.).
 * 401   — session missing / GitHub token rejected.
 * 400   — missing or malformed query params.
 */
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(200),
  path: z.string().min(1).max(1000),
  ref: z.string().min(1).max(255),
});

export async function GET(request: NextRequest) {
  // 1. Session check via Supabase SSR cookies.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  // 2. Query params.
  const params = QuerySchema.safeParse({
    owner: request.nextUrl.searchParams.get('owner'),
    repo: request.nextUrl.searchParams.get('repo'),
    path: request.nextUrl.searchParams.get('path'),
    ref: request.nextUrl.searchParams.get('ref'),
  });
  if (!params.success) {
    return NextResponse.json(
      { message: 'invalid query params', issues: params.error.issues },
      { status: 400 },
    );
  }

  // 3. GitHub provider_token. Missing = relink.
  let token: string;
  try {
    token = await getGithubToken();
  } catch (error) {
    if (error instanceof MissingProviderTokenError) {
      return NextResponse.json(
        { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
        { status: 401 },
      );
    }
    throw error;
  }

  // 4. Forward to GitHub. `unauthorized` from view-time = bad token =
  // relink; everything else passes through as a `200 ok:false` so the
  // client can render the right fallback.
  const result = await getFileAtRef({ ...params.data, token });

  if (!result.ok && result.error.kind === 'unauthorized') {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
      { status: 401 },
    );
  }

  return NextResponse.json(result);
}
