import { describe, expect, it } from 'vitest';
import type { CitedHunk, NarrativeChapter, NarrativeReview } from '@/review/narrative';
import { HAND_BEFORE_AFTER } from '@/report/test/diagram-fixtures';
import { hunkLineCount } from './inline-diff-snippets';
import {
  chapterMinutes,
  chapterSeconds,
  formatMinutes,
  hunkSeconds,
  overviewMinutes,
  readingPlanRows,
  wholeMinutes,
} from './reading-time';

function hunk(
  tier: CitedHunk['tier'],
  original: number,
  modified: number,
  id = 'H0001',
  fileOrder = 0,
): CitedHunk {
  return {
    id,
    fileOrder,
    original: { startLine: 1, lineCount: original },
    modified: { startLine: 1, lineCount: modified },
    tier,
    ...(tier === 'mechanical' ? { reason: 'the same rename at 14 call sites' } : {}),
  };
}

function chapter(
  id: string,
  hunks: CitedHunk[],
  extra: Partial<NarrativeChapter> = {},
): NarrativeChapter {
  return {
    id,
    title: id,
    insights: [],
    diffChunks: [{ filename: `src/${id}.ts`, language: 'typescript', hunks }],
    ...extra,
  };
}

/** `n` words of prose. */
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

describe('a hunk’s reading time', () => {
  it('counts the longer of its two spans', () => {
    expect(hunkLineCount(hunk('read', 3, 9))).toBe(9);
    expect(hunkLineCount(hunk('read', 9, 0))).toBe(9);
  });

  it('reads 12 lines a minute, skims 40, and gives a folded row five seconds', () => {
    expect(hunkSeconds(hunk('read', 0, 12))).toBe(60);
    expect(hunkSeconds(hunk('skim', 0, 40))).toBe(60);
    expect(hunkSeconds(hunk('mechanical', 0, 400))).toBe(5);
  });
});

describe('a chapter’s reading time', () => {
  it('adds its prose at 200 words a minute: lede, body and every insight’s text', () => {
    const prose = chapter('c', [], {
      description: { lede: words(50), body: words(100) },
      insights: [
        { type: 'context', title: 'not counted', text: words(30) },
        { type: 'highlight', text: words(20) },
      ],
    });
    expect(chapterSeconds(prose, 'shown')).toBe(60);
  });

  it('adds each hunk by its own tier, and 30 seconds for a diagram', () => {
    const mixed = chapter(
      'c',
      [hunk('read', 0, 6), hunk('skim', 10, 10), hunk('mechanical', 2, 2)],
      {
        diagram: HAND_BEFORE_AFTER,
      },
    );
    // 30s read, 15s skimmed, 5s folded, 30s of diagram.
    expect(chapterSeconds(mixed, 'shown')).toBe(80);
  });

  it('charges a run of adjacent mechanical hunks once, as the one row the reader folds it to', () => {
    const adjacent = chapter('c', [
      hunk('mechanical', 2, 2, 'H0001', 1),
      hunk('mechanical', 2, 2, 'H0002', 2),
    ]);
    expect(chapterSeconds(adjacent, 'shown')).toBe(5);
  });

  it('charges mechanical hunks a read hunk separates as two rows', () => {
    const split = chapter('c', [
      hunk('mechanical', 2, 2, 'H0001', 1),
      hunk('read', 0, 2, 'H0002', 2),
      hunk('mechanical', 2, 2, 'H0003', 3),
    ]);
    // Two folded rows at 5s, and 2 lines read at 12 a minute.
    expect(chapterSeconds(split, 'shown')).toBe(20);
  });

  it('charges a run of skim hunks as one folded row when the reader folds skim', () => {
    const skimmed = chapter('c', [
      hunk('skim', 0, 40, 'H0001', 1),
      hunk('skim', 0, 40, 'H0002', 2),
      hunk('read', 0, 12, 'H0003', 3),
    ]);
    // Shown: 80 lines skimmed at 40 a minute. Folded: one 5s row. Either way, a minute read.
    expect(chapterSeconds(skimmed, 'shown')).toBe(180);
    expect(chapterSeconds(skimmed, 'folded')).toBe(65);
  });

  it('skims each excerpt of unchanged code, and reads its reason as prose', () => {
    const withExcerpt = chapter('c', [], {
      contextExcerpts: [
        { filename: 'src/runner.ts', startLine: 11, endLine: 30, reason: words(40) },
      ],
    });
    // 20 lines skimmed at 40 a minute, and 40 words at 200.
    expect(chapterSeconds(withExcerpt, 'shown')).toBe(42);
  });

  it('rounds up to a whole minute, and never down to none', () => {
    expect(chapterMinutes(chapter('c', [hunk('read', 0, 12)]), 'shown')).toBe(1);
    expect(chapterMinutes(chapter('c', [hunk('read', 0, 13)]), 'shown')).toBe(2);
    expect(chapterMinutes(chapter('c', [hunk('mechanical', 1, 1)]), 'shown')).toBe(1);
    expect(wholeMinutes(0)).toBe(1);
  });

  it('does not let the residue of adding fractions push an exact minute over', () => {
    expect(wholeMinutes(60 + 1e-9)).toBe(1);
    expect(wholeMinutes(61)).toBe(2);
  });

  it('is written with a tilde, since it is an estimate', () => {
    expect(formatMinutes(3)).toBe('~3 min');
  });
});

describe('the reading plans', () => {
  const chapters = [
    chapter('types', [hunk('read', 0, 25)]),
    chapter('core', [hunk('read', 0, 50)]),
    chapter('wiring', [hunk('skim', 0, 40), hunk('mechanical', 0, 3, 'H0002')]),
  ];

  function review(overrides: Partial<NarrativeReview> = {}): NarrativeReview {
    return { prTitle: 't', overviewSummary: { lede: words(10) }, chapters, ...overrides };
  }

  it('times the overview by its prose, and its diagram', () => {
    expect(
      overviewMinutes(review({ overviewSummary: { lede: words(150), body: words(60) } })),
    ).toBe(2);
    expect(overviewMinutes(review({ overviewDiagram: HAND_BEFORE_AFTER }))).toBe(1);
  });

  it('sums each plan’s chapter estimates over the overview, and lists what each adds', () => {
    // types 3 min (125s), core 5 min (250s), wiring 2 min (65s), overview 1 min.
    const rows = readingPlanRows(
      review({ readingPlan: { brief: ['core'], standard: ['types', 'core'] } }),
      'shown',
    );
    expect(rows.map((row) => [row.name, row.minutes, row.adds.map((c) => c.id)])).toEqual([
      ['Brief', 6, ['core']],
      ['Standard', 9, ['types']],
      ['Full', 11, ['wiring']],
    ]);
  });

  it('follows the skim preference, as the chapter headers do', () => {
    // wiring, skim folded: two 5s rows, so 1 min rather than 2.
    const rows = readingPlanRows(
      review({ readingPlan: { brief: ['core'], standard: ['types', 'core'] } }),
      'folded',
    );
    expect(rows.map((row) => row.minutes)).toEqual([6, 9, 10]);
  });

  it('has no rows for a review with no plan', () => {
    expect(readingPlanRows(review(), 'shown')).toEqual([]);
  });
});
