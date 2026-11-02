import { describe, expect, it } from 'vitest';
import type { Diagram } from '../review/diagram.ts';
import type { Finding } from '../review/findings.ts';
import type { Expect } from './diagram-case.ts';
import {
  deserved,
  diagramStats,
  examplePhrases,
  findEchoes,
  isIdentifierLabel,
  sampleFigures,
  sampleVerdict,
  scoreReview,
  type SampleScore,
} from './diagram-score.ts';

const architecture: Diagram = {
  id: 'map',
  kind: 'architecture',
  title: 'Capture failure path',
  caption: 'A failed capture parks a retry.',
  direction: 'right',
  nodes: [
    {
      id: 'create',
      label: 'createOrder',
      kind: 'code',
      change: 'modified',
      filename: 'src/orders/create.ts',
    },
    { id: 'gateway', label: 'Card gateway', kind: 'external', change: 'unchanged' },
    {
      id: 'worker',
      label: 'Packing worker',
      kind: 'code',
      change: 'unchanged',
      filename: 'src/worker/worker.ts',
    },
    { id: 'queue', label: 'RetryQueue', kind: 'data', change: 'added' },
  ],
  edges: [
    { from: 'create', to: 'gateway', label: 'capture', change: 'unchanged' },
    { from: 'create', to: 'queue', change: 'added' },
  ],
};

const state: Diagram = {
  id: 'life',
  kind: 'state',
  title: 'Retry lifecycle',
  caption: 'Placed until captured or given up.',
  direction: 'right',
  nodes: [
    { id: 'placed', label: 'placed', kind: 'data', change: 'unchanged', initial: true },
    { id: 'paid', label: 'paid', kind: 'data', change: 'unchanged' },
  ],
  edges: [{ from: 'placed', to: 'paid', label: 'captured', change: 'added' }],
};

const sequence: Diagram = {
  id: 'seq',
  kind: 'sequence',
  title: 'Capture',
  caption: 'Three endings.',
  participants: [
    { id: 'api', label: 'Orders route', kind: 'code', change: 'unchanged' },
    { id: 'gw', label: 'gateway.capture()', kind: 'external', change: 'unchanged' },
  ],
  steps: [
    { type: 'message', from: 'api', to: 'gw', label: 'capture', style: 'call', change: 'added' },
    {
      type: 'group',
      style: 'alt',
      branches: [
        {
          label: 'ok',
          steps: [
            {
              type: 'message',
              from: 'gw',
              to: 'api',
              label: 'captured',
              style: 'return',
              change: 'added',
            },
          ],
        },
        {
          label: 'failed',
          steps: [
            {
              type: 'group',
              style: 'loop',
              branches: [
                {
                  steps: [
                    {
                      type: 'message',
                      from: 'api',
                      to: 'gw',
                      label: 'retry',
                      style: 'call',
                      change: 'added',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const expectMap: Expect = {
  overview: { kinds: ['architecture'] },
  chapterDiagrams: { min: 0, max: 1, kinds: ['sequence'] },
  mustName: [],
  mustReach: ['src/worker/worker.ts', 'src/store/store.ts'],
  question: 'Where does a failed capture go?',
};

const control: Expect = {
  overview: null,
  chapterDiagrams: { min: 0, max: 0, kinds: [] },
  mustName: [],
  mustReach: [],
  question: 'What changed?',
};

function review(overviewDiagram: Diagram | undefined, ...chapterDiagrams: (Diagram | undefined)[]) {
  return {
    overviewDiagram,
    chapters: chapterDiagrams.map((diagram, at) => ({
      title: `Chapter ${String(at + 1)}`,
      diagram,
    })),
  } as Parameters<typeof scoreReview>[0];
}

describe('isIdentifierLabel', () => {
  it('finds a code-shaped word, and leaves words named by what they do alone', () => {
    const labels = {
      createOrder: true,
      RetryQueue: true,
      'retryCaptures sweep': true,
      'src/orders/create.ts': true,
      'capture()': true,
      retry_queue: true,
      'Cardflow gateway': false,
      'placed, attempt 1 queued': false,
      Worker: false,
      'HTTP routes': false,
    };
    expect(
      Object.fromEntries(Object.keys(labels).map((label) => [label, isIdentifierLabel(label)])),
    ).toEqual(labels);
  });
});

describe('examplePhrases', () => {
  it('reads the quoted phrases of the Diagram Style section and nothing else', () => {
    const prompt = [
      '## Overview Style',
      'Write it as "a short story".',
      '## Diagram Style',
      'Name a node "Loan service" or "Loans table"; mark it "unchanged".',
      'Group them ("Request handlers").',
      '## Pull Request',
      'Title: "Not an example either"',
    ].join('\n');
    expect(examplePhrases(prompt)).toEqual(['Loan service', 'Loans table', 'Request handlers']);
  });

  it('is null for a prompt with no Diagram Style section', () => {
    expect(examplePhrases('## Pull Request\nTitle: "Retry a capture"')).toBeNull();
  });
});

describe('findEchoes', () => {
  const examples = ['Loan service', 'Overdue reminder job', 'Request handlers'];
  const vocabulary = new Set(['request', 'handler', 'service', 'order', 'reminder']);

  it('counts a label holding a whole example, and one holding an example word the change never uses', () => {
    expect(
      findEchoes(
        ['Request handlers', 'Order service', 'Overdue orders sweep', 'Reminder email', 'Loans'],
        examples,
        vocabulary,
      ),
    ).toEqual({
      copied: ['Request handlers'],
      foreign: ['Overdue orders sweep', 'Loans'],
    });
  });

  it('finds nothing in labels drawn from the change itself', () => {
    expect(findEchoes(['Order service', 'Request handler'], examples, vocabulary)).toEqual({
      copied: [],
      foreign: [],
    });
  });
});

describe('diagramStats', () => {
  it('counts a graph’s nodes, unchanged nodes, identifier labels, labelled edges and grounding', () => {
    expect(diagramStats('overview', architecture)).toMatchObject({
      where: 'overview',
      kind: 'architecture',
      nodes: 4,
      unchanged: 2,
      identifierLabels: 2,
      edges: 2,
      labelledEdges: 1,
      filenames: ['src/orders/create.ts', 'src/worker/worker.ts'],
    });
  });

  it('counts a sequence’s participants as nodes and every message, nested groups included, as a labelled edge', () => {
    expect(diagramStats('Capture', sequence)).toMatchObject({
      nodes: 2,
      unchanged: 2,
      identifierLabels: 1,
      edges: 3,
      labelledEdges: 3,
    });
  });
});

describe('scoreReview', () => {
  it('is on target when the overview is an allowed kind and the chapter diagrams fit the range and kinds', () => {
    const score = scoreReview(review(architecture, undefined, sequence), [], expectMap);
    expect(score).toMatchObject({
      overview: { kind: 'architecture', ok: true },
      chapters: { kinds: ['sequence'], ok: true },
      onTarget: true,
      missed: false,
      reached: ['src/worker/worker.ts'],
      drops: 0,
      retried: false,
    });
    expect(score.diagrams.map((stats) => stats.where)).toEqual(['overview', 'Chapter 2']);
  });

  it('is off when a chapter draws a kind the branch does not allow, or more diagrams than its range', () => {
    expect(scoreReview(review(architecture, state), [], expectMap)).toMatchObject({
      chapters: { kinds: ['state'], ok: false },
      onTarget: false,
      missed: false,
    });
    expect(scoreReview(review(architecture, sequence, sequence), [], expectMap).chapters.ok).toBe(
      false,
    );
  });

  it('has missed when a deserved overview, or the least of chapter diagrams, is not drawn', () => {
    expect(scoreReview(review(undefined), [], expectMap)).toMatchObject({
      overview: { kind: null, ok: false },
      onTarget: false,
      missed: true,
    });
    const atLeastOne = {
      ...expectMap,
      chapterDiagrams: { min: 1, max: 1, kinds: ['state' as const] },
    };
    expect(scoreReview(review(architecture), [], atLeastOne).missed).toBe(true);
    expect(scoreReview(review(architecture, state, state), [], atLeastOne).missed).toBe(false);
  });

  it('holds the control to no diagram anywhere', () => {
    expect(scoreReview(review(undefined, undefined), [], control).onTarget).toBe(true);
    expect(scoreReview(review(architecture), [], control).overview.ok).toBe(false);
    expect(scoreReview(review(undefined, state), [], control).chapters.ok).toBe(false);
  });

  it('reaches a file through a folder that holds it, and a folder only through itself', () => {
    const wide = { ...expectMap, mustReach: ['src/store/store.ts', 'src/worker/', 'src/http/'] };
    const folders: Diagram = {
      ...architecture,
      nodes: [
        {
          id: 'store',
          label: 'Orders store',
          kind: 'data',
          change: 'unchanged',
          filename: 'src/store/',
        },
        {
          id: 'worker',
          label: 'Worker',
          kind: 'code',
          change: 'unchanged',
          filename: 'src/worker/',
        },
        {
          id: 'route',
          label: 'Order route',
          kind: 'code',
          change: 'unchanged',
          filename: 'src/http/routes/orders.ts',
        },
      ],
      edges: [],
    };
    expect(scoreReview(review(folders), [], wide).reached).toEqual([
      'src/store/store.ts',
      'src/worker/',
    ]);
  });

  it('counts what the parser dropped from diagrams and whether the answer needed a retry', () => {
    const findings: Finding[] = [
      { code: 'diagram-part-dropped', severity: 'note', message: 'a filename' },
      { code: 'diagram-dropped', severity: 'warning', message: 'a whole one' },
      { code: 'passed-after-retry', severity: 'warning', message: 'once' },
      { code: 'excerpt-dropped', severity: 'warning', message: 'not a diagram' },
    ];
    expect(scoreReview(review(architecture), findings, expectMap)).toMatchObject({
      drops: 2,
      retried: true,
    });
  });
});

describe('the one-line formatters', () => {
  const meta = { exitCode: 0, ms: 60_000, costUsd: 0.94, turns: 6, failure: null };

  it('says what a branch deserves', () => {
    expect(deserved(expectMap)).toBe('overview architecture, chapter diagrams 0–1 sequence');
    expect(deserved(control)).toBe('overview none, chapter diagrams none');
  });

  it('gives a sample’s verdict and counts, and says a failed sample failed', () => {
    const sample: SampleScore = {
      sample: 1,
      meta,
      echoes: { copied: ['Request handlers'], foreign: [] },
      review: scoreReview(review(architecture, state), [], expectMap),
    };
    expect(sampleVerdict(sample)).toBe('off  ·  overview architecture  ·  chapters state ✗');
    expect(sampleFigures(sample, 2)).toBe(
      '6 nodes  ·  unchanged 67%  ·  identifier labels 33%  ·  labelled edges 67%  ·  reached 1 of 2  ·  copied examples 1  ·  $0.94',
    );
    const failed: SampleScore = {
      sample: 2,
      meta: { ...meta, exitCode: 1, failure: 'boom' },
      echoes: null,
      review: null,
    };
    expect(sampleVerdict(failed)).toBe('FAILED (er exited 1)');
    expect(sampleFigures(failed, 2)).toBe('');
  });
});
