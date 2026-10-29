import { describe, expect, it } from 'vitest';
import type { DiffHunk } from '../review/prompt/diff-hunk-catalog.ts';
import type { Label } from './skim-case.ts';
import { carryLabels, defaultCaseName, hunkBodies, seedLabels } from './skim-import.ts';
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

describe('hunkBodies', () => {
  it('keys each hunk by the marker above it, its trailing blank lines dropped', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '# H0001',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '# H0002',
      '@@ -9 +9 @@',
      ' kept',
      '+c',
      '',
      'diff --git a/src/b.ts b/src/b.ts',
      '# H0003',
      '@@ -0,0 +1 @@',
      '+d',
      '',
    ].join('\n');
    expect([...hunkBodies(diff)]).toEqual([
      ['H0001', '@@ -1 +1 @@\n-a\n+b'],
      ['H0002', '@@ -9 +9 @@\n kept\n+c'],
      ['H0003', '@@ -0,0 +1 @@\n+d'],
    ]);
  });
});

const label = (id: string, extra: Partial<Label> = {}): Label => ({
  id,
  file: 'src/a.ts',
  header: `@@ ${id} @@`,
  tier: 'read',
  ...extra,
});

describe('hunkBodies on split parts', () => {
  it('leaves out the part tag, so a part renumbered by a new cut still matches', () => {
    const before = hunkBodies(['# H0003', '@@ -80,0 +89,13 @@ (part 2 of 5)', '+a'].join('\n'));
    const after = hunkBodies(['# H0007', '@@ -80,0 +89,13 @@ (part 2 of 6)', '+a'].join('\n'));
    expect(before.get('H0003')).toBe(after.get('H0007'));
  });
});

describe('carryLabels', () => {
  it('gives a hunk with the same lines the old judgement under its new id', () => {
    const previous = [label('H0001', { tier: 'skim', category: 'docs', note: 'why' })];
    const carried = carryLabels(
      previous,
      new Map([['H0001', 'same lines']]),
      [label('H0004', { header: '@@ moved down @@' })],
      new Map([['H0004', 'same lines']]),
    );
    expect(carried).toEqual([
      {
        id: 'H0004',
        file: 'src/a.ts',
        header: '@@ moved down @@',
        tier: 'skim',
        category: 'docs',
        note: 'why',
      },
    ]);
  });

  it('leaves a hunk cut differently, or an unjudged one, as the run seeded it', () => {
    const previous = [label('H0001', { category: 'test-case' }), label('H0002')];
    const seeded = [label('H0001', { tier: 'skim' }), label('H0002', { tier: 'skim' })];
    const carried = carryLabels(
      previous,
      new Map([
        ['H0001', 'old part'],
        ['H0002', 'unjudged'],
      ]),
      seeded,
      new Map([
        ['H0001', 'new part'],
        ['H0002', 'unjudged'],
      ]),
    );
    expect(carried).toEqual(seeded);
  });

  it('keeps a hunk the new run proves, whatever it was labelled', () => {
    const carried = carryLabels(
      [label('H0001', { category: 'wiring' })],
      new Map([['H0001', 'imports']]),
      [label('H0001', { tier: 'proven' })],
      new Map([['H0001', 'imports']]),
    );
    expect(carried[0]!.tier).toBe('proven');
  });
});
