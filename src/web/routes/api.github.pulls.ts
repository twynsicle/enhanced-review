import { z } from 'zod';
import { listOpenPulls } from '@/domain/github/pulls.server';
import { githubFailure, withGithub } from '@/web/lib/github.server';
import type { PullsResponse } from '@/web/lib/github-api';
import { parseParams } from '@/web/lib/parse.server';
import type { Route } from './+types/api.github.pulls';

const ParamsSchema = z.object({ owner: z.string().min(1), repo: z.string().min(1) });

/** GET /api/github/repos/:owner/:repo/pulls — open PRs, most recently updated first. */
export function loader({ request, params }: Route.LoaderArgs) {
  const { owner, repo } = parseParams(ParamsSchema, params);
  return withGithub(request, async (client) => {
    try {
      const body: PullsResponse = {
        ok: true,
        fullName: `${owner}/${repo}`,
        pulls: await listOpenPulls(client, owner, repo),
      };
      return body;
    } catch (err) {
      return githubFailure(err, `${owner}/${repo}`);
    }
  });
}
