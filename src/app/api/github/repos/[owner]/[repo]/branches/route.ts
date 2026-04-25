import { listRecentBranches } from '@enhanced-review/github-client';
import { type NextRequest, NextResponse } from 'next/server';
import { createServerOctokit, githubErrorResponse } from '@/lib/github/server';

/**
 * GET /api/github/repos/[owner]/[repo]/branches
 *
 * Returns branches whose tip commit is within the last 30 days, sorted
 * newest-first, plus the repo's default branch (used as the base ref when
 * a branch target is selected).
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/github/repos/[owner]/[repo]/branches'>,
) {
  const { owner, repo } = await ctx.params;
  try {
    const octokit = await createServerOctokit();
    const result = await listRecentBranches(octokit, owner, repo);
    return NextResponse.json(result);
  } catch (error) {
    return githubErrorResponse(error);
  }
}
