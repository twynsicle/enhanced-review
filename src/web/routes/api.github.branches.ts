import { z } from 'zod';
import { listRecentBranches } from '@/domain/github/branches.server';
import { githubFailure, withGithub } from '@/web/lib/github.server';
import type { BranchesResponse } from '@/web/lib/github-api';
import { parseParams } from '@/web/lib/parse.server';
import type { Route } from './+types/api.github.branches';

const ParamsSchema = z.object({ owner: z.string().min(1), repo: z.string().min(1) });

/** GET /api/github/repos/:owner/:repo/branches — branches active in the last 30 days + the default branch. */
export function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = parseParams(ParamsSchema, params);
  return withGithub(request, async (client) => {
    try {
      const body: BranchesResponse = {
        ok: true,
        fullName: `${owner}/${repo}`,
        ...(await listRecentBranches(client, owner, repo)),
      };
      return body;
    } catch (err) {
      return githubFailure(err, `${owner}/${repo}`);
    }
  });
}
