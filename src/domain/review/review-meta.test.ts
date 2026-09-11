import { describe, expect, it } from 'vitest';
import type { PullMetadata } from '../github/types.ts';
import { ReviewMetaSchema, reviewMetaFromJob } from './review-meta.ts';
import type { BranchReviewTarget, PullReviewTarget } from './target.ts';

const pr: PullReviewTarget = {
  kind: 'pr',
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  title: 'Add scheduled reviews',
  headSha: 'a'.repeat(40),
  baseSha: 'b'.repeat(40),
};

const branch: BranchReviewTarget = {
  kind: 'branch',
  owner: 'acme',
  repo: 'widgets',
  ref: 'feat/scheduler',
  headSha: 'a'.repeat(40),
  baseRef: 'main',
  baseSha: 'b'.repeat(40),
};

const pull: PullMetadata = {
  title: 'Scheduled reviews, take two',
  authorLogin: 'octocat',
  authorAvatarUrl: null,
  body: 'Why this exists.',
  baseRefName: 'main',
  headRefName: 'feat/scheduler',
  baseSha: 'b'.repeat(40),
  headSha: 'a'.repeat(40),
  changedFiles: 3,
  additions: 40,
  deletions: 2,
  htmlUrl: 'https://github.com/acme/widgets/pull/7',
};

describe('reviewMetaFromJob', () => {
  it('takes the header from GitHub when it answered', () => {
    const meta = reviewMetaFromJob(pr, pull, 'someone');
    expect(meta).toEqual({
      repo: 'acme/widgets',
      title: 'Scheduled reviews, take two',
      prNumber: 7,
      baseRefName: 'main',
      headRefName: 'feat/scheduler',
      authorLogin: 'octocat',
      description: 'Why this exists.',
      stats: { changedFiles: 3, additions: 40, deletions: 2 },
    });
    expect(ReviewMetaSchema.parse(meta)).toEqual(meta);
  });

  it('falls back to the stored PR target when GitHub did not answer', () => {
    expect(reviewMetaFromJob(pr, null, 'someone')).toEqual({
      repo: 'acme/widgets',
      title: 'Add scheduled reviews',
      prNumber: 7,
      baseRefName: null,
      headRefName: null,
      authorLogin: 'someone',
      description: null,
      stats: null,
    });
  });

  it('names a branch review by its refs, with no PR number', () => {
    const meta = reviewMetaFromJob(branch, null, 'someone');
    expect(meta.title).toBe('feat/scheduler');
    expect(meta.prNumber).toBeNull();
    expect(meta.headRefName).toBe('feat/scheduler');
    expect(meta.baseRefName).toBe('main');
  });

  it('skips an empty GitHub title rather than showing a blank header', () => {
    expect(reviewMetaFromJob(pr, { ...pull, title: '' }, 'someone').title).toBe(
      'Add scheduled reviews',
    );
  });

  it('keeps the job author when GitHub has no author login', () => {
    expect(reviewMetaFromJob(pr, { ...pull, authorLogin: null }, 'someone').authorLogin).toBe(
      'someone',
    );
  });
});
