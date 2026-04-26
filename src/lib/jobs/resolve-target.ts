import 'server-only';
import type { ReviewTarget } from '@enhanced-review/github-client';
import type { Octokit } from 'octokit';

interface ResolvedReviewTarget {
  target: ReviewTarget;
  headSha: string;
}

export async function resolveFreshReviewTarget(
  octokit: Octokit,
  target: ReviewTarget,
): Promise<ResolvedReviewTarget> {
  if (target.kind === 'pr') {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
      owner: target.owner,
      repo: target.repo,
      pull_number: target.number,
    });
    const freshTarget: ReviewTarget = {
      ...target,
      title: data.title,
      headSha: data.head.sha,
      baseSha: data.base.sha,
    };
    return { target: freshTarget, headSha: data.head.sha };
  }

  const [{ data: head }, { data: base }] = await Promise.all([
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

  const freshTarget: ReviewTarget = {
    ...target,
    headSha: head.commit.sha,
    baseSha: base.commit.sha,
  };
  return { target: freshTarget, headSha: head.commit.sha };
}
