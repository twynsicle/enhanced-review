import { listRepos } from '@enhanced-review/github-client';
import { NextResponse } from 'next/server';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';

/**
 * GET /api/github/repos
 *
 * Returns the first 100 repos accessible to the signed-in user, sorted by
 * most-recently pushed. Pagination is intentionally absent for v1.
 *
 * Auth is enforced by `proxy.ts`; this handler additionally relies on the
 * GitHub access token being present (otherwise → 401 → `/relink`).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const octokit = await createServerOctokit();
    const repos = await listRepos(octokit);
    return NextResponse.json({ repos });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
