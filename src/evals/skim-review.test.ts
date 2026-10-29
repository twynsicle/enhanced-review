import { describe, expect, it } from 'vitest';
import type { DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import type { SkimCase } from './skim-case.ts';
import { citedTiers, runAnswer, type ReviewTiers } from './skim-review.ts';

const hunk = (id: string, header = `@@ ${id} @@`): DiffHunk => ({
  id,
  filename: 'src/a.ts',
  header,
  fileOrder: 1,
  original: { startLine: 1, lineCount: 1 },
  modified: { startLine: 1, lineCount: 1 },
  changedLines: 1,
});

const skimCase: SkimCase = {
  name: 'pr-1',
  source: { folder: 'er-reviews/pr-1/x', repo: 'o/r', kind: 'pr' },
  title: 't',
  description: null,
  commits: [],
  files: [],
  hunks: [hunk('H0001'), hunk('H0002')],
};

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

describe('citedTiers', () => {
  it('takes each hunk’s tier, read winning where chapters disagree', () => {
    expect([...citedTiers(review).values()]).toEqual([
      { id: 'H0001', tier: 'skim', skimReason: 'docs' },
      { id: 'H0002', tier: 'read' },
    ]);
  });
});

describe('runAnswer', () => {
  it('is the review’s tiers as one sample when the run numbered the case’s hunks', () => {
    const answer = runAnswer(skimCase, skimCase.hunks, review, 'run');
    expect(answer.problems).toEqual([]);
    expect(answer.tiers.get('H0002')?.tier).toBe('read');
  });

  it('refuses a run whose hunks are not the case’s, since its ids name other lines', () => {
    expect(() => runAnswer(skimCase, [hunk('H0001')], review, 'run')).toThrow(
      'run did not number the hunks pr-1 labels: 1 hunks where the case has 2',
    );
    const resplit = [hunk('H0001'), hunk('H0002', '@@ -1 +1 @@ (part 1 of 2)')];
    expect(() => runAnswer(skimCase, resplit, review, 'run')).toThrow(
      'H0002 is src/a.ts @@ -1 +1 @@ (part 1 of 2), where the case has H0002',
    );
  });
});
