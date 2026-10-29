import { describe, expect, it } from 'vitest';
import type { DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import { defaultCaseName, seedLabels } from './skim-import.ts';
import type { ReviewTiers } from './skim-review.ts';

const hunk = (id: string, facts: Partial<DiffHunk> = {}): DiffHunk => ({
  id,
  filename: 'src/a.ts',
  header: `@@ ${id} @@`,
  fileOrder: 1,
  original: { startLine: 1, lineCount: 1 },
  modified: { startLine: 1, lineCount: 1 },
  changedLines: 1,
  ...facts,
});

const review: ReviewTiers = {
  chapters: [
    {
      diffChunks: [
        {
          hunks: [
            { id: 'H0001', tier: 'skim', skimReason: 'docs' },
            { id: 'H0002', tier: 'skim', skimReason: 'first' },
          ],
        },
      ],
    },
    { diffChunks: [{ hunks: [{ id: 'H0002', tier: 'read' }] }] },
  ],
};

describe('seedLabels', () => {
  it('seeds each hunk from the review, read winning where chapters disagree', () => {
    const labels = seedLabels(
      [hunk('H0001'), hunk('H0002'), hunk('H0003'), hunk('H0004', { whitespaceOnly: true })],
      review,
    );
    expect(labels).toEqual([
      { id: 'H0001', file: 'src/a.ts', header: '@@ H0001 @@', tier: 'skim', note: 'docs' },
      { id: 'H0002', file: 'src/a.ts', header: '@@ H0002 @@', tier: 'read' },
      { id: 'H0003', file: 'src/a.ts', header: '@@ H0003 @@', tier: 'read' },
      { id: 'H0004', file: 'src/a.ts', header: '@@ H0004 @@', tier: 'proven' },
    ]);
  });

  it('seeds every hunk read when there is no review, as a stub run leaves it', () => {
    expect(seedLabels([hunk('H0001')], null).map((label) => label.tier)).toEqual(['read']);
  });
});

describe('defaultCaseName', () => {
  it('is the run folder’s slug', () => {
    expect(defaultCaseName('er-reviews/pr-38/20261016-080937')).toBe('pr-38');
    expect(defaultCaseName('er-reviews/branch-feat-x/20261016-080937/')).toBe('branch-feat-x');
  });
});
