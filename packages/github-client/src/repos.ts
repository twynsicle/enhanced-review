import type { Octokit } from 'octokit';
import { rethrowAuth } from './errors';
import type { RepoSummary } from './types';

const DEFAULT_PAGE_SIZE = 100;

/**
 * List the user's accessible repos, sorted by most-recently pushed.
 *
 * Uses GitHub's REST `/user/repos` with `affiliation=owner,collaborator,
 * organization_member` so org-collab repos show up alongside personal ones.
 * Capped at the first 100 (one page) for v1.
 */
export async function listRepos(octokit: Octokit): Promise<RepoSummary[]> {
  try {
    const response = await octokit.request('GET /user/repos', {
      affiliation: 'owner,collaborator,organization_member',
      sort: 'pushed',
      direction: 'desc',
      per_page: DEFAULT_PAGE_SIZE,
      page: 1,
    });

    return response.data.map(
      (r): RepoSummary => ({
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
      }),
    );
  } catch (error) {
    rethrowAuth(error);
  }
}
