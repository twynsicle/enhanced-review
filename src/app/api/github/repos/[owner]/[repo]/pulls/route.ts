import { listOpenPulls } from '@enhanced-review/github-client';
import { type NextRequest, NextResponse } from 'next/server';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';

/**
 * GET /api/github/repos/[owner]/[repo]/pulls
 *
 * Returns the first 100 open PRs for `owner/repo`, sorted by most-recently
 * updated. `head`/`base` SHAs are inlined so the picker can resolve a full
 * `ReviewTarget` without a follow-up call.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/github/repos/[owner]/[repo]/pulls'>,
) {
  const { owner, repo } = await ctx.params;
  try {
    const octokit = await createServerOctokit();
    const pulls = await listOpenPulls(octokit, owner, repo);
    return NextResponse.json({ pulls });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
