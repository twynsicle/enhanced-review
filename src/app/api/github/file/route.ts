import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth/auth';
import { getGithubTokenFor } from '@/lib/github/token';
import { getFileAtRef } from '@/lib/github/view-time';

/**
 * GET /api/github/file?owner=...&repo=...&path=...&ref=...
 *
 * Server-side proxy that the diff reader calls to load base/head file
 * blobs. The token is read from the Auth.js `accounts` table — never from
 * a cookie, never reaches the browser.
 *
 * Response shape mirrors the {@link import('@/lib/github/view-time').ViewTimeResult}
 * discriminated union except for hard auth failures, which return 401
 * with a `github_token_invalid` reason so `lib/github/fetcher.ts` can
 * trigger the `/relink` redirect.
 *
 * 200 + `{ ok: true, content, language, lineCount }` — file fetched.
 * 200 + `{ ok: false, error }` — handled gracefully by the component.
 * 401  — session missing / GitHub token rejected.
 * 400  — missing or malformed query params.
 */
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(200),
  path: z.string().min(1).max(1000),
  ref: z.string().min(1).max(255),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

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

  const token = await getGithubTokenFor(session.user.id);
  if (!token) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
      { status: 401 },
    );
  }

  const result = await getFileAtRef({ ...params.data, token });

  if (!result.ok && result.error.kind === 'unauthorized') {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'GitHub token is invalid; please re-link.' },
      { status: 401 },
    );
  }

  return NextResponse.json(result);
}
