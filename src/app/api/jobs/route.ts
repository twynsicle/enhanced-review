import 'server-only';
import { GithubAuthError, isAuthError, type ReviewTarget } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { getGithubLogin } from '@/lib/auth/allowlist';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';
import { ReviewTargetSchema } from '@/lib/jobs/target';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createServerSupabase } from '@/lib/supabase/server';

/**
 * POST /api/jobs
 *
 * Create a `review_jobs` row for the supplied `ReviewTarget`. The picker
 * page POSTs here when the user clicks the "Review" button.
 *
 * Auth model:
 *   - Session is verified via @supabase/ssr (`getUser`).
 *   - The route then reaches for the user's GitHub provider_token to
 *     re-resolve `head_sha` server-side — the picker may have selected
 *     a target before recent pushes landed.
 *   - The insert runs through the service-role client so the row can be
 *     written with `user_id` + `github_login` copied from the verified
 *     session (RLS would otherwise restrict what columns can be set).
 *
 * Returns `{ id }` on success. 401 on missing/invalid session or
 * provider_token (client redirects to /relink). 400 on bad body.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  // 1. Session
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ message: 'unauthorized' }, { status: 401 });
  }

  const githubLogin = getGithubLogin(user);
  if (!githubLogin) {
    return NextResponse.json(
      { reason: 'github_token_invalid', message: 'No GitHub identity on this session.' },
      { status: 401 },
    );
  }

  // 2. Body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = ReviewTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { message: 'invalid review target', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const target: ReviewTarget = parsed.data;

  // 3. Re-resolve head_sha from GitHub (always — the client value is a
  // hint, not a source of truth). Token errors map to the same shape the
  // picker already handles.
  let headSha: string;
  try {
    const octokit = await createServerOctokit();
    if (target.kind === 'pr') {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
      });
      headSha = data.head.sha;
    } else {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: target.owner,
        repo: target.repo,
        branch: target.ref,
      });
      headSha = data.commit.sha;
    }
  } catch (error) {
    if (error instanceof GithubAuthError || isAuthError(error)) {
      return githubErrorResponse(error);
    }
    console.error('[api/jobs] head_sha resolution failed', error);
    return NextResponse.json(
      { message: 'failed to resolve head SHA from GitHub' },
      { status: 502 },
    );
  }

  // 4. Insert via service role.
  const admin = createAdminClient();
  const { data: row, error: insertError } = await admin
    .from('review_jobs')
    .insert({
      user_id: user.id,
      github_login: githubLogin,
      target,
      head_sha: headSha,
    })
    .select('id')
    .single();

  if (insertError || !row) {
    console.error('[api/jobs] insert failed', insertError);
    return NextResponse.json({ message: 'failed to create job' }, { status: 500 });
  }

  return NextResponse.json({ id: row.id });
}
