import { type GithubClient, rethrowAuth } from './client.server.ts';
import type { RepoSummary } from './types.ts';

const PAGE_SIZE = 100;

/**
 * The user's accessible repos, most recently pushed first. `affiliation`
 * includes org-collab repos alongside personal ones. One page (100) for v1.
 */
export async function listRepos(octokit: GithubClient): Promise<RepoSummary[]> {
  try {
    const response = await octokit.request('GET /user/repos', {
      affiliation: 'owner,collaborator,organization_member',
      sort: 'pushed',
      direction: 'desc',
      per_page: PAGE_SIZE,
      page: 1,
    });
    return response.data.map((r): RepoSummary => ({
      owner: r.owner?.login ?? '',
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      private: Boolean(r.private),
      fork: Boolean(r.fork),
      archived: Boolean(r.archived),
      defaultBranch: r.default_branch ?? 'main',
      pushedAt: r.pushed_at ?? null,
      htmlUrl: r.html_url,
    }));
  } catch (error) {
    rethrowAuth(error);
  }
}
