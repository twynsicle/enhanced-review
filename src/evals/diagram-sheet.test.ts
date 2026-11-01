import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DiagramBranchSpec } from './diagram-case.ts';
import type { DiagramSweep } from './diagram-run.ts';
import type { Diagram } from '../review/diagram.ts';
import type { JudgedOverview } from './diagram-judge.ts';
import { scoreReview, type BranchScore } from './diagram-score.ts';
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
            missed: true,
            diagrams: [],
            reached: [],
            drops: 0,
            retried: false,
          },
        },
      ],
    },
  ];
  return { folder: path.join('results', stamp), record, scores, judged: [] };
}

const graph = (id: string, kind: 'architecture' | 'state'): Diagram => ({
  id,
  kind,
  title: id,
  caption: 'c',
  direction: 'right',
  nodes: [
    { id: 'a', label: 'A', kind: 'code', change: 'added' },
    { id: 'b', label: 'B', kind: 'code', change: 'unchanged' },
  ],
  edges: [],
});

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
      verdict: 'missed  ·  overview none ✗  ·  chapters none',
    });
  });

  it('carries each judge’s verdict onto the overview it judged, and none onto a chapter’s diagram', () => {
    const drawn = sweep('20261031-100000', 2);
    const review = {
      overviewDiagram: graph('map', 'architecture'),
      chapters: [
        {
          id: 'c1',
          title: 'Retry sweep',
          headline: 'h',
          insights: [],
          diffChunks: [],
          diagram: graph('life', 'state'),
        },
      ],
    };
    drawn.scores[0]!.samples[0]!.review = scoreReview(review, [], spec.expect);
    const judged: JudgedOverview[] = [
      {
        judge: 'judge-a',
        branch: 'retry-queue',
        sample: 1,
        parsed: {
          judgement: { answer: 'x', mechanisms: ['yes'], rating: 'good', reason: 'Clear.' },
          problems: [],
        },
      },
      {
        judge: 'judge-b',
        branch: 'retry-queue',
        sample: 1,
        parsed: { judgement: null, problems: ['no block', 'no reason'] },
      },
    ];
    const sheet = contactSheet([{ ...drawn, judged }], path.join('results', '20261031-100000'));
    const diagrams = sheet.branches[0]?.bands[0]?.[0]?.diagrams ?? [];
    expect(diagrams.map(({ where, judgements }) => [where, judgements])).toEqual([
      [
        'overview',
        [
          { judge: 'judge-a', rating: 'good', reason: 'Clear.' },
          { judge: 'judge-b', rating: null, reason: 'no block; no reason' },
        ],
      ],
      ['Retry sweep', []],
    ]);
  });
});
