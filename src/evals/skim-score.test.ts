import { describe, expect, it } from 'vitest';
import { parseTierAnswer } from './skim-answer.ts';
import type { Label, SkimCase } from './skim-case.ts';
import { formatCaseScore, formatOverall, scoreCase, scoreSample, spread } from './skim-score.ts';

const label = (id: string, tier: Label['tier'], category?: string): Label => ({
  id,
  file: 'src/a.ts',
  header: `@@ ${id} @@`,
  tier,
  ...(category ? { category } : {}),
});

const labels: Label[] = [
  label('H0001', 'read', 'logic'),
  label('H0002', 'read', 'test-case'),
  label('H0003', 'skim', 'wiring'),
  label('H0004', 'skim', 'docs'),
  label('H0005', 'either', 'logic'),
  label('H0006', 'proven'),
  label('H0007', 'read'),
];

const answer = (json: string) => parseTierAnswer(`<hunk_tiers>${json}</hunk_tiers>`);

const skimCase = { name: 'c', title: 'A change' } as SkimCase;

describe('scoreSample', () => {
  it('judges only rows a person labelled, and keeps the two errors apart', () => {
    const score = scoreSample(
      labels,
      answer(
        '{"hunks":[{"id":"H0001","tier":"read"},{"id":"H0002","tier":"skim","skimReason":"fixtures"},{"id":"H0003","tier":"read"},{"id":"H0005","tier":"skim","skimReason":"x"},{"id":"H0006","tier":"read"},{"id":"H0007","tier":"skim","skimReason":"y"}]}',
      ),
    );
    expect(score).toMatchObject({
      judged: 4,
      agreed: 1,
      skimmedRead: 1,
      readSkim: 1,
      missing: 1,
      longReasons: 0,
      problems: [],
    });
    expect(score.byCategory).toEqual({
      logic: { judged: 1, agreed: 1, skimmedRead: 0, readSkim: 0, missing: 0 },
      'test-case': { judged: 1, agreed: 0, skimmedRead: 1, readSkim: 0, missing: 0 },
      wiring: { judged: 1, agreed: 0, skimmedRead: 0, readSkim: 1, missing: 0 },
      docs: { judged: 1, agreed: 0, skimmedRead: 0, readSkim: 0, missing: 1 },
    });
    // Three judged hunks answered, one of them skim.
    expect(score.modelSkimRate).toBeCloseTo(1 / 3);
  });

  it('counts a skim reason the reader would drop', () => {
    const score = scoreSample(
      labels,
      answer(
        `{"hunks":[{"id":"H0003","tier":"skim","skimReason":"${'a'.repeat(41)}"},{"id":"H0004","tier":"skim","skimReason":"docs"}]}`,
      ),
    );
    expect(score.longReasons).toBe(1);
    expect(score.agreed).toBe(2);
  });
});

describe('scoreCase', () => {
  const answers = [
    answer(
      '{"hunks":[{"id":"H0001","tier":"skim","skimReason":"boilerplate"},{"id":"H0002","tier":"read"},{"id":"H0003","tier":"skim","skimReason":"wiring"},{"id":"H0004","tier":"read"}]}',
    ),
    answer(
      '{"hunks":[{"id":"H0001","tier":"skim","skimReason":"scaffolding"},{"id":"H0002","tier":"read"},{"id":"H0003","tier":"skim","skimReason":"wiring"},{"id":"H0004","tier":"skim","skimReason":"docs"}]}',
    ),
    answer(
      '{"hunks":[{"id":"H0001","tier":"read"},{"id":"H0002","tier":"read"},{"id":"H0003","tier":"skim","skimReason":"wiring"},{"id":"H0004","tier":"skim","skimReason":"docs"}]}',
    ),
  ];

  it('lists the hunks wrong in at least half the samples, with every reason the model gave', () => {
    const score = scoreCase(skimCase, labels, answers);
    expect(score).toMatchObject({
      hunks: 7,
      judged: 4,
      proven: 1,
      either: 1,
      unlabelled: 1,
      labelSkimRate: 0.5,
    });
    expect(score.samples.map((sample) => sample.agreed)).toEqual([2, 3, 4]);
    expect(score.disagreements).toEqual([
      {
        id: 'H0001',
        file: 'src/a.ts',
        header: '@@ H0001 @@',
        category: 'logic',
        label: 'read',
        modelRead: 1,
        modelSkim: 2,
        missing: 0,
        reasons: ['boilerplate', 'scaffolding'],
      },
    ]);
  });

  it('prints each category’s figures with their spread, and the hunks to look at', () => {
    const lines = formatCaseScore(scoreCase(skimCase, labels, answers));
    expect(lines[0]).toBe('c  A change');
    expect(lines[1]).toBe('  7 hunks: 4 judged, 1 proven, 1 either, 1 unlabelled  ·  3 samples');
    expect(lines.find((text) => text.trimStart().startsWith('all '))).toBe(
      `  ${'all'.padEnd(18)}  ${'4'.padStart(5)}  ${'75% (50%–100%)'.padStart(16)}  ${'0.7 (0–1)'.padStart(14)}  ${'0.3 (0–1)'.padStart(12)}  ${'0'.padStart(9)}`,
    );
    expect(lines.at(-2)).toBe('  wrong in 2+ of 3 samples:');
    expect(lines.at(-1)).toBe(
      '    H0001  src/a.ts  @@ H0001 @@  [logic]  label read  ·  model read ×1, skim ×2  “boilerplate” / “scaffolding”',
    );
  });

  it('pools the cases sample by sample', () => {
    const one = scoreCase(skimCase, labels, answers);
    const lines = formatOverall([one, one]);
    expect(lines[0]).toBe('all 2 cases  ·  3 samples each');
    expect(lines[2]).toContain(`${'8'.padStart(5)}  ${'75% (50%–100%)'.padStart(16)}`);
    expect(formatOverall([])).toEqual([]);
  });
});

describe('spread', () => {
  it('is one value when the samples agree and a mean with its range when they do not', () => {
    expect(spread([2, 2, 2], String)).toBe('2');
    expect(spread([1, 2, 3], String)).toBe('2 (1–3)');
    expect(spread([], String)).toBe('–');
  });
});
