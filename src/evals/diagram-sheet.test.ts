import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiagramBranchSpec } from './diagram-case.ts';
import type { DiagramSweep } from './diagram-run.ts';
import type { BranchScore } from './diagram-score.ts';
import { contactSheet } from './diagram-sheet.ts';

const spec = {
  branch: 'feat/retry',
  title: 'Retry a failed capture',
  description: '',
  commit: { subject: 's', body: '' },
  removed: [],
  expect: {
    overview: { kinds: ['architecture'] },
    chapterDiagrams: { min: 0, max: 1, kinds: ['sequence'] },
    mustName: ['a retry is queued'],
    mustReach: ['src/worker/worker.ts'],
    question: 'Where does it go?',
  },
} satisfies DiagramBranchSpec;

const meta = { exitCode: 0, ms: 1, costUsd: 0.5, turns: 3, failure: null };

function sweep(stamp: string, costUsd: number) {
  const record: DiagramSweep = {
    model: null,
    diagramStyle: 'mechanism',
    samples: 1,
    branches: ['retry-queue'],
    digests: { 'retry-queue': 'abc' },
    startedAt: '',
    finishedAt: '',
    costUsd,
  };
  const scores: BranchScore[] = [
    {
      name: 'retry-queue',
      spec,
      samples: [
        {
          sample: 1,
          meta,
          review: {
            overview: { kind: null, ok: false },
            chapters: { kinds: [], ok: true },
            onTarget: false,
            diagrams: [],
            reached: [],
            drops: 0,
            retried: false,
          },
        },
      ],
    },
  ];
  return { folder: path.join('results', stamp), record, scores };
}

describe('contactSheet', () => {
  it('puts each sweep in its own band, linking each sample’s review relative to the sheet', () => {
    const sheet = contactSheet(
      [sweep('20261030-100000', 1.5), sweep('20261031-100000', 2)],
      path.join('results', '20261031-100000'),
    );
    expect(sheet.sweeps).toEqual([
      {
        stamp: '20261030-100000',
        summary: "er's default model, mechanism diagrams, 1 branches × 1 samples, $1.50",
      },
      {
        stamp: '20261031-100000',
        summary: "er's default model, mechanism diagrams, 1 branches × 1 samples, $2.00",
      },
    ]);
    const [branch] = sheet.branches;
    expect(branch).toMatchObject({
      name: 'retry-queue',
      deserves: 'overview architecture, chapter diagrams 0–1 sequence',
      question: 'Where does it go?',
      mustReach: ['src/worker/worker.ts'],
    });
    expect(branch?.bands.map((band) => band[0]?.href)).toEqual([
      '../20261030-100000/retry-queue/sample-1/review.html',
      'retry-queue/sample-1/review.html',
    ]);
    expect(branch?.bands[0]?.[0]).toMatchObject({
      onTarget: false,
      verdict: 'off  ·  overview none ✗  ·  chapters none',
    });
  });
});
