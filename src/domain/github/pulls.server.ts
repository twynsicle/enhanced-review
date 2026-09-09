import { type GithubClient, rethrowAuth } from './client.server.ts';
import type { PullSummary } from './types.ts';

const PAGE_SIZE = 100;

/**
 * Open pull requests, most recently updated first, one page. Head and base
 * SHAs come from the listing so the picker needs no second call.
 */
export async function listOpenPulls(
  octokit: GithubClient,
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
      per_page: PAGE_SIZE,
      page: 1,
    });
    return response.data.map((p): PullSummary => ({
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
    }));
  } catch (error) {
    rethrowAuth(error);
  }
}
