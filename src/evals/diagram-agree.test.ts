import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agreement,
  formatAgreement,
  judgeRatings,
  judgeReasons,
  ratedKey,
  readUserRatings,
  RATINGS_FILE,
  type Rated,
} from './diagram-agree.ts';
import type { Rating } from '../report/sheet/sheet-data.ts';
import type { JudgedOverview } from './diagram-judge.ts';

const rated = (entries: [string, number, Rating][]): Rated =>
  new Map(entries.map(([branch, sample, rating]) => [ratedKey(branch, sample), rating]));

describe('agreement', () => {
  it('counts exact and within-one agreement on the overviews both rated, and lists the rest', () => {
    const you = rated([
      ['a', 1, 'good'],
      ['a', 2, 'usable'],
      ['b', 1, 'poor'],
      ['b', 2, 'good'],
    ]);
    const judge = rated([
      ['a', 1, 'good'],
      ['a', 2, 'good'],
      ['b', 1, 'good'],
      ['c', 1, 'poor'],
    ]);
    const result = agreement('you', you, 'judge', judge);
    expect(result).toMatchObject({ compared: 3, exact: 1, withinOne: 2 });
    expect(result.disagreements).toEqual([
      { key: 'a sample 2', first: 'usable', second: 'good' },
      { key: 'b sample 1', first: 'poor', second: 'good' },
    ]);
    // Agreement 1/3 against chance (1/3·1 + 1/3·0 + 1/3·0) = 1/3: no better than chance.
    expect(result.kappa).toBeCloseTo(0);
  });

  it('gives kappa 1 for full agreement across ratings, and none when chance alone agrees on all', () => {
    const mixed = rated([
      ['a', 1, 'good'],
      ['a', 2, 'poor'],
    ]);
    expect(agreement('x', mixed, 'y', mixed).kappa).toBe(1);
    const allGood = rated([
      ['a', 1, 'good'],
      ['a', 2, 'good'],
    ]);
    expect(agreement('x', allGood, 'y', allGood).kappa).toBeNull();
  });

  it('says so when the two rated nothing in common', () => {
    const result = agreement('you', rated([['a', 1, 'good']]), 'judge', rated([['b', 1, 'good']]));
    expect(formatAgreement(result)).toEqual(['you and judge rated no overview in common']);
  });

  it('formats the figures, then each disagreement with the reason given for it', () => {
    const result = agreement(
      'you',
      rated([
        ['a', 1, 'good'],
        ['a', 2, 'poor'],
      ]),
      'judge',
      rated([
        ['a', 1, 'good'],
        ['a', 2, 'usable'],
      ]),
    );
    expect(formatAgreement(result, new Map([['a sample 2', 'The sweep is implied.']]))).toEqual([
      'you and judge, 2 overviews: agree 50%  ·  within one 100%  ·  kappa 0.33',
      '  a sample 2: you poor, judge usable (The sweep is implied.)',
    ]);
  });
});

describe('the judges’ ratings and reasons', () => {
  const judged: JudgedOverview[] = [
    {
      judge: 'j',
      branch: 'a',
      sample: 1,
      parsed: {
        judgement: { answer: 'x', mechanisms: [], rating: 'good', reason: 'Clear.' },
        problems: [],
      },
    },
    { judge: 'j', branch: 'a', sample: 2, parsed: { judgement: null, problems: ['no block'] } },
    {
      judge: 'k',
      branch: 'a',
      sample: 1,
      parsed: {
        judgement: { answer: 'x', mechanisms: [], rating: 'poor', reason: 'Wrong.' },
        problems: [],
      },
    },
  ];

  it('takes one judge’s clean judgements and leaves out an unreadable one', () => {
    expect(judgeRatings(judged, 'j')).toEqual(new Map([['a sample 1', 'good']]));
    expect(judgeReasons(judged, 'k')).toEqual(new Map([['a sample 1', 'Wrong.']]));
  });
});

describe('readUserRatings', () => {
  let sweep: string;
  beforeEach(() => {
    sweep = path.join(mkdtempSync(path.join(tmpdir(), 'er-diagram-agree-')), '20261101-133250');
    mkdirSync(sweep);
  });
  afterEach(() => {
    rmSync(path.dirname(sweep), { recursive: true, force: true });
  });

  it('keeps the ratings of this sweep, by its stamp, from a file that rates two', async () => {
    writeFileSync(
      path.join(sweep, RATINGS_FILE),
      JSON.stringify({
        ratings: [
          { stamp: '20261101-133250', branch: 'a', sample: 1, rating: 'good' },
          { stamp: '20261101-123435', branch: 'a', sample: 1, rating: 'poor' },
        ],
      }),
    );
    expect(await readUserRatings(sweep)).toEqual(new Map([['a sample 1', 'good']]));
  });

  it('says how to make the file when it is missing, and refuses one that rates nothing here', async () => {
    await expect(readUserRatings(sweep)).rejects.toThrow('rate the overviews on this sweep');
    writeFileSync(
      path.join(sweep, RATINGS_FILE),
      JSON.stringify({ ratings: [{ stamp: 'other', branch: 'a', sample: 1, rating: 'good' }] }),
    );
    await expect(readUserRatings(sweep)).rejects.toThrow('rates nothing in sweep 20261101-133250');
  });
});
