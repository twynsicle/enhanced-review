import { type GithubClient, toResult } from './client.server.ts';
import type { GithubResult, PullMetadata } from './types.ts';

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * The PR header: title, body, author, refs, SHAs and change counts. The
 * runner feeds it into the prompt and the reader shows it in the SummaryCard.
 */
export function getPullMetadata(
  octokit: GithubClient,
  ref: PullRef,
  signal?: AbortSignal,
): Promise<GithubResult<PullMetadata>> {
  return toResult(async () => {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      request: signal ? { signal } : undefined,
    });
    return {
      title: data.title,
      authorLogin: data.user?.login ?? null,
      authorAvatarUrl: data.user?.avatar_url ?? null,
      body: data.body,
      baseRefName: data.base.ref,
      headRefName: data.head.ref,
      baseSha: data.base.sha,
      headSha: data.head.sha,
      changedFiles: data.changed_files,
      additions: data.additions,
      deletions: data.deletions,
      htmlUrl: data.html_url,
    };
  });
}
