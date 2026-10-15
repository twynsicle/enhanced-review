import { describe, expect, it } from 'vitest';
import type { NarrativeReview } from '@/review/narrative';
import type { ReviewMeta } from '@/review/review-meta';
import { changeLabel, documentTitle } from './change-label';

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

describe('changeLabel', () => {
  const tagOf = (meta: ReviewMeta, title = 'A title') => changeLabel(review(title), meta).tag;

  it('tags a PR with its number', () => {
    expect(tagOf(pr)).toEqual({ text: '#42', kind: 'number' });
  });

  it('tags a branch with an open PR with the PR number', () => {
    expect(tagOf({ ...branch, prNumber: 7 })).toEqual({ text: '#7', kind: 'number' });
  });

  it('gives a branch with no PR no tag', () => {
    expect(tagOf(branch)).toBeNull();
  });

  it('tags staged changes as staged', () => {
    expect(tagOf(staged)).toEqual({ text: 'staged', kind: 'staged' });
  });

  it("uses the review's title, or the meta's when the review gave none", () => {
    expect(changeLabel(review('Schedules, hourly'), pr).title).toBe('Schedules, hourly');
    expect(changeLabel(review(''), pr).title).toBe('Add scheduled reviews');
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
