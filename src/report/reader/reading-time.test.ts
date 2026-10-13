import { describe, expect, it } from 'vitest';
import type { CitedHunk, NarrativeChapter, NarrativeReview } from '@/review/narrative';
import { HAND_BEFORE_AFTER } from '@/report/test/diagram-fixtures';
import {
  chapterMinutes,
  chapterSeconds,
  formatMinutes,
  hunkLines,
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
    expect(hunkLines(hunk('read', 3, 9))).toBe(9);
    expect(hunkLines(hunk('read', 9, 0))).toBe(9);
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
    expect(chapterSeconds(prose)).toBe(60);
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
    expect(chapterSeconds(mixed)).toBe(80);
  });

  it('charges a run of adjacent mechanical hunks once, as the one row the reader folds it to', () => {
    const adjacent = chapter('c', [
      hunk('mechanical', 2, 2, 'H0001', 1),
      hunk('mechanical', 2, 2, 'H0002', 2),
    ]);
    expect(chapterSeconds(adjacent)).toBe(5);
  });

  it('charges mechanical hunks a read hunk separates as two rows', () => {
    const split = chapter('c', [
      hunk('mechanical', 2, 2, 'H0001', 1),
      hunk('read', 0, 2, 'H0002', 2),
      hunk('mechanical', 2, 2, 'H0003', 3),
    ]);
    // Two folded rows at 5s, and 2 lines read at 12 a minute.
    expect(chapterSeconds(split)).toBe(20);
  });

  it('rounds up to a whole minute, and never down to none', () => {
    expect(chapterMinutes(chapter('c', [hunk('read', 0, 12)]))).toBe(1);
    expect(chapterMinutes(chapter('c', [hunk('read', 0, 13)]))).toBe(2);
    expect(chapterMinutes(chapter('c', [hunk('mechanical', 1, 1)]))).toBe(1);
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
    );
    expect(rows.map((row) => [row.name, row.minutes, row.adds.map((c) => c.id)])).toEqual([
      ['Brief', 6, ['core']],
      ['Standard', 9, ['types']],
      ['Full', 11, ['wiring']],
    ]);
  });

  it('has no rows for a review with no plan', () => {
    expect(readingPlanRows(review())).toEqual([]);
  });
});
