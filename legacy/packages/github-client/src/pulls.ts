import type { Octokit } from 'octokit';
import { rethrowAuth } from './errors';
import type { PullSummary } from './types';

const DEFAULT_PAGE_SIZE = 100;

/**
 * List open pull requests for a repo, sorted by most-recently updated.
 * Capped at 100 results — `headSha`/`baseSha` are pulled from the listing
 * payload so the picker doesn't need a second call to render selection.
 */
export async function listOpenPulls(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<PullSummary[]> {
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      per_page: DEFAULT_PAGE_SIZE,
      page: 1,
    });

    return response.data.map(
      (p): PullSummary => ({
        number: p.number,
        title: p.title,
        state: 'open',
        draft: Boolean(p.draft),
        authorLogin: p.user?.login ?? null,
        authorAvatarUrl: p.user?.avatar_url ?? null,
        headRef: p.head.ref,
        headSha: p.head.sha,
        baseRef: p.base.ref,
        baseSha: p.base.sha,
        htmlUrl: p.html_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }),
    );
  } catch (error) {
    rethrowAuth(error);
  }
}
