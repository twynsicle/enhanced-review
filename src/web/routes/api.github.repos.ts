import { listRepos } from '@/domain/github/repos.server';
import { githubFailure, withGithub } from '@/web/lib/github.server';
import type { ReposResponse } from '@/web/lib/github-api';
import type { Route } from './+types/api.github.repos';

/** GET /api/github/repos — the caller's accessible repos, most recently pushed first. */
export function loader({ request }: Route.LoaderArgs) {
  return withGithub(request, async (client) => {
    try {
      const body: ReposResponse = { ok: true, repos: await listRepos(client) };
      return body;
    } catch (err) {
      return githubFailure(err);
    }
  });
}
