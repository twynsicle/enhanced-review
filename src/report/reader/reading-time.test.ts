import { describe, expect, it } from 'vitest';
import type { CitedHunk, NarrativeChapter, NarrativeReview } from '@/review/narrative';
import { HAND_BEFORE_AFTER } from '@/report/test/diagram-fixtures';
import {
  chapterMinutes,
  chapterSeconds,
  formatMinutes,
  hunkSeconds,
  readingPlanRows,
  wholeMinutes,
} from './reading-time';

/** A hunk of `changed` added lines, with git's three context lines either side. */
function hunk(tier: CitedHunk['tier'], changed: number, id = 'H0001', fileOrder = 0): CitedHunk {
  return {
    id,
    fileOrder,
    original: { startLine: 1, lineCount: 6 },
    modified: { startLine: 1, lineCount: changed + 6 },
    changedLines: changed,
    tier,
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
    headline: '',
    insights: [],
    diffChunks: [{ filename: `src/${id}.ts`, language: 'typescript', hunks }],
    ...extra,
  };
}

/** `n` words of prose. */
const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

describe('a hunk’s reading time', () => {
  it('reads 25 changed lines a minute and skims 100', () => {
    expect(hunkSeconds(hunk('read', 25))).toBe(60);
    expect(hunkSeconds(hunk('skim', 100))).toBe(60);
  });

  it('counts only the changed lines, not the context around them', () => {
    expect(hunkSeconds(hunk('read', 5))).toBe(12);
  });
});

describe('a chapter’s reading time', () => {
  it('adds its prose at 200 words a minute: lede, body and every insight’s text', () => {
    const prose = chapter('c', [], {
      headline: words(50),
      body: words(100),
      insights: [
        { type: 'context', title: 'not counted', text: words(30) },
        { type: 'highlight', text: words(20) },
      ],
    });
    expect(chapterSeconds(prose)).toBe(60);
  });

  it('adds each hunk by its own tier, and 30 seconds for a diagram', () => {
    const mixed = chapter('c', [hunk('read', 10), hunk('skim', 50, 'H0002', 1)], {
      diagram: HAND_BEFORE_AFTER,
    });
    // 24s read, 30s skimmed, 30s of diagram.
    expect(chapterSeconds(mixed)).toBe(84);
  });

  it('skims each excerpt of unchanged code, and reads its reason as prose', () => {
    const withExcerpt = chapter('c', [], {
      contextExcerpts: [
        { filename: 'src/runner.ts', startLine: 11, endLine: 30, reason: words(40) },
      ],
    });
    // 20 lines skimmed at 100 a minute, and 40 words at 200.
    expect(chapterSeconds(withExcerpt)).toBe(24);
  });

  it('rounds up to a whole minute, and never down to none', () => {
    expect(chapterMinutes(chapter('c', [hunk('read', 25)]))).toBe(1);
    expect(chapterMinutes(chapter('c', [hunk('read', 26)]))).toBe(2);
    expect(chapterMinutes(chapter('c', [hunk('skim', 1)]))).toBe(1);
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
  // types 120s, core 240s, wiring 66s; the overview's ten words 3s.
  const chapters = [
    chapter('types', [hunk('read', 50)]),
    chapter('core', [hunk('read', 100)]),
    chapter('wiring', [hunk('skim', 100), hunk('skim', 10, 'H0002', 1)]),
  ];

  function review(overrides: Partial<NarrativeReview> = {}): NarrativeReview {
    return { prTitle: 't', overviewSummary: { lede: words(10) }, chapters, ...overrides };
  }

  it('opens every plan with the overview, timed by its prose and its diagram', () => {
    const overviewOnly = (overrides: Partial<NarrativeReview>) =>
      readingPlanRows(
        review({
          chapters: [chapter('empty', [])],
          readingPlan: { brief: ['empty'], standard: ['empty'] },
          ...overrides,
        }),
      )[0]!.minutes;
    // 110 words is 33s; a diagram adds 30.
    expect(overviewOnly({ overviewSummary: { lede: words(110) } })).toBe(1);
    expect(
      overviewOnly({ overviewSummary: { lede: words(110) }, overviewDiagram: HAND_BEFORE_AFTER }),
    ).toBe(2);
  });

  it('rounds each plan once over the overview and its chapters, and lists what each adds', () => {
    const rows = readingPlanRows(
      review({ readingPlan: { brief: ['core'], standard: ['types', 'core'] } }),
    );
    // Brief 243s, Standard 363s, Full 429s. Summing the rounded headers instead
    // (1 + 2 + 4 + 2) would make the full read 9.
    expect(rows.map((row) => [row.name, row.minutes, row.adds.map((c) => c.id)])).toEqual([
      ['Brief', 5, ['core']],
      ['Standard', 7, ['types']],
      ['Full', 8, ['wiring']],
    ]);
  });

  it('has no rows for a review with no plan', () => {
    expect(readingPlanRows(review())).toEqual([]);
  });
});
