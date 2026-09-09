import { createOctokit } from '@/domain/github/client.server';
import { getPullMetadata } from '@/domain/github/pull-metadata.server';
import type { BranchHead, PullMetadata } from '@/domain/github/types';
import { getBranchHead, getCommitsAhead } from '@/domain/github/view-time.server';
import type { BranchReviewTarget, ReviewTarget } from '@/domain/review/target';

/**
 * What the reader fetches from GitHub at view time: the PR header for the
 * summary card and the target's current head for the staleness banner. Every
 * call degrades on its own — a viewer without a token, or one GitHub rejects,
 * still gets the chapters, insights and markdown.
 */
export interface ReviewMetadata {
  pullMetadata: PullMetadata | null;
  /** The target's head on GitHub right now; null when it could not be read. */
  currentHeadSha: string | null;
  /** Commits between the reviewed head and the current one (0 when unknown). */
  commitsAhead: number;
}

export const EMPTY_REVIEW_METADATA: ReviewMetadata = {
  pullMetadata: null,
  currentHeadSha: null,
  commitsAhead: 0,
};

export async function loadReviewMetadata(args: {
  token: string | null;
  target: ReviewTarget;
  /** The head the review was pinned to (`review_jobs.head_sha`). */
  headSha: string;
  /** The job owner's login: the branch case has no PR author to show. */
  githubLogin: string;
}): Promise<ReviewMetadata> {
  if (!args.token) return EMPTY_REVIEW_METADATA;
  const client = createOctokit(args.token);
  const { owner, repo } = args.target;
  const result: ReviewMetadata = { ...EMPTY_REVIEW_METADATA };

  if (args.target.kind === 'pr') {
    const metadata = await getPullMetadata(client, {
      owner,
      repo,
      number: args.target.number,
    });
    if (metadata.ok) {
      result.pullMetadata = metadata.data;
      result.currentHeadSha = metadata.data.headSha;
    }
  } else {
    const branch = await getBranchHead(client, { owner, repo, ref: args.target.ref });
    if (branch.ok) {
      result.currentHeadSha = branch.data.sha;
      result.pullMetadata = synthesizeBranchSummary(args.target, branch.data, args.githubLogin);
    }
  }

  if (result.currentHeadSha && result.currentHeadSha !== args.headSha) {
    const compare = await getCommitsAhead(client, {
      owner,
      repo,
      base: args.headSha,
      head: result.currentHeadSha,
    });
    if (compare.ok) result.commitsAhead = compare.data.count;
  }

  return result;
}

/** A thin PR-shaped record for a branch target so the summary card needs no second variant. */
function synthesizeBranchSummary(
  target: BranchReviewTarget,
  branch: BranchHead,
  githubLogin: string,
): PullMetadata {
  return {
    title: branch.commitMessage.split('\n')[0] || target.ref,
    authorLogin: githubLogin,
    authorAvatarUrl: `https://github.com/${githubLogin}.png`,
    body: null,
    baseRefName: target.baseRef,
    headRefName: target.ref,
    baseSha: target.baseSha,
    headSha: branch.sha,
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    htmlUrl: `https://github.com/${target.owner}/${target.repo}/tree/${target.ref}`,
  };
}
