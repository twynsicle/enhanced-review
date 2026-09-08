import type { ReviewTarget } from '../review/target.ts';
import { type GithubClient, rethrowAuth } from './client.server.ts';

export interface ResolvedReviewTarget {
  target: ReviewTarget;
  headSha: string;
}

/**
 * Re-pin a target to what GitHub says right now: fresh head and base SHAs
 * (and the PR title). Called before every job insert so a stale picker
 * selection or a rerun of an old job reviews the current code.
 */
export async function resolveFreshReviewTarget(
  octokit: GithubClient,
  target: ReviewTarget,
): Promise<ResolvedReviewTarget> {
  try {
    if (target.kind === 'pr') {
      const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: target.owner,
        repo: target.repo,
        pull_number: target.number,
      });
      return {
        target: { ...target, title: data.title, headSha: data.head.sha, baseSha: data.base.sha },
        headSha: data.head.sha,
      };
    }

    const [head, base] = await Promise.all([
      octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: target.owner,
        repo: target.repo,
        branch: target.ref,
      }),
      octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: target.owner,
        repo: target.repo,
        branch: target.baseRef,
      }),
    ]);
    return {
      target: { ...target, headSha: head.data.commit.sha, baseSha: base.data.commit.sha },
      headSha: head.data.commit.sha,
    };
  } catch (error) {
    rethrowAuth(error);
  }
}
