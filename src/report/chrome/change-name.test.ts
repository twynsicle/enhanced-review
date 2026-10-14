import { describe, expect, it } from 'vitest';
import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { changeTag, changeTitle, documentTitle } from './change-name';

const pr: ReviewMeta = {
  repo: 'acme/widgets',
  kind: 'pr',
  title: 'Add scheduled reviews',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  prNumber: 42,
  baseRefName: 'main',
  headRefName: 'feat/schedules',
  authorLogin: 'someone',
  description: null,
  stats: null,
};
const branch: ReviewMeta = {
  ...pr,
  kind: 'branch',
  title: 'feat/schedules',
  prNumber: null,
  authorLogin: null,
};
const staged: ReviewMeta = {
  ...branch,
  kind: 'staged',
  title: 'Staged changes on main',
  headRefName: 'staged',
};

const review = (prTitle: string): NarrativeReview => ({
  prTitle,
  overviewSummary: { lede: 'x' },
  chapters: [],
});

describe('changeTag', () => {
  it('is the PR number for a PR', () => {
    expect(changeTag(pr)).toBe('#42');
  });

  it('is the PR number for a branch with an open PR', () => {
    expect(changeTag({ ...branch, prNumber: 7 })).toBe('#7');
  });

  it('is the branch for a branch with no PR', () => {
    expect(changeTag(branch)).toBe('feat/schedules');
  });

  it('is "staged" for staged changes', () => {
    expect(changeTag(staged)).toBe('staged');
  });
});

describe('changeTitle', () => {
  it("is the review's title, or the meta's when the review gave none", () => {
    expect(changeTitle(review('Schedules, hourly'), pr)).toBe('Schedules, hourly');
    expect(changeTitle(review(''), branch)).toBe('feat/schedules');
  });
});

describe('documentTitle', () => {
  it('leads with the PR number when there is one', () => {
    expect(documentTitle(review('Add schedules'), pr)).toBe(
      '#42 · Add schedules · enhanced-review',
    );
  });

  it('is the title alone otherwise', () => {
    expect(documentTitle(review('Add schedules'), branch)).toBe('Add schedules · enhanced-review');
    expect(documentTitle(review('Add schedules'), staged)).toBe('Add schedules · enhanced-review');
  });
});
