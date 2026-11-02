import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SdkQueryFn } from '../cli/sdk-loop.ts';
import type { Diagram } from '../review/diagram.ts';
import type { DiagramBranchSpec } from './diagram-case.ts';
import {
  buildJudgePrompt,
  describeDiagram,
  formatJudged,
  judgementFiles,
  overviews,
  parseJudgement,
  readJudgements,
  runJudge,
} from './diagram-judge.ts';
import { scoreReview, type BranchScore } from './diagram-score.ts';

const map: Diagram = {
  id: 'map',
  kind: 'architecture',
  title: 'Where a failed capture goes',
  caption: 'A failed capture parks a retry for the sweep.',
  direction: 'right',
  groups: [{ id: 'svc', label: 'Order service' }],
  nodes: [
    {
      id: 'create',
      label: 'Order creation',
      kind: 'code',
      change: 'modified',
      filename: 'src/orders/create.ts',
      group: 'svc',
    },
    { id: 'gateway', label: 'Card gateway', kind: 'external', change: 'unchanged' },
    { id: 'worker', label: 'Worker', kind: 'code', change: 'unchanged', filename: 'src/worker/' },
  ],
  edges: [
    { from: 'create', to: 'gateway', label: 'capture', change: 'unchanged' },
    { from: 'create', to: 'worker', change: 'added' },
  ],
};

const spec: DiagramBranchSpec = {
  branch: 'feat/retry',
  title: 'Retry a failed capture',
  description: 'A gateway error now queues a retry instead of failing the order.',
  commit: { subject: 'Retry', body: '' },
  removed: [],
  expect: {
    overview: { kinds: ['architecture'] },
    chapterDiagrams: { min: 0, max: 1, kinds: ['sequence'] },
    mustName: ['a gateway error queues a retry', 'the sweep drains retries'],
    mustReach: [],
    question: 'Where does a failed capture go?',
  },
};

const judgement = (fields: Record<string, unknown>) =>
  `Thinking aloud first.\n<diagram_judgement>${JSON.stringify(fields)}</diagram_judgement>`;

const clean = {
  answer: 'It parks a retry the worker picks up.',
  mechanisms: [
    { mechanism: 'a gateway error queues a retry', shown: 'yes' },
    { mechanism: 'the sweep drains retries', shown: 'partly' },
  ],
  rating: 'usable',
  reason: 'The sweep is implied, not drawn.',
};

describe('describeDiagram', () => {
  it('writes a node a line with its kind, change, path and group, and an edge a line by its ends’ labels', () => {
    expect(describeDiagram(map)).toBe(
      [
        'Kind: architecture',
        'Title: Where a failed capture goes',
        'Caption: A failed capture parks a retry for the sweep.',
        'Nodes:',
        '- Order creation (code, modified) in src/orders/create.ts, inside "Order service"',
        '- Card gateway (external, unchanged)',
        '- Worker (code, unchanged) in src/worker/',
        'Edges:',
        '- Order creation → Card gateway: capture (unchanged)',
        '- Order creation → Worker (added)',
      ].join('\n'),
    );
  });

  it('refuses a sequence, which an overview never is', () => {
    const sequence: Diagram = {
      id: 'seq',
      kind: 'sequence',
      title: 'Flow',
      caption: 'One pass.',
      participants: [
        { id: 'a', label: 'A', kind: 'code', change: 'unchanged' },
        { id: 'b', label: 'B', kind: 'code', change: 'unchanged' },
      ],
      steps: [{ type: 'message', from: 'a', to: 'b', label: 'go', style: 'call', change: 'added' }],
    };
    expect(() => describeDiagram(sequence)).toThrow('not a sequence');
  });
});

describe('buildJudgePrompt', () => {
  it('gives the judge what the change does, the question, the mechanisms and the overview', () => {
    const prompt = buildJudgePrompt(spec, map);
    for (const part of [
      spec.description,
      spec.expect.question,
      '- a gateway error queues a retry',
      '- the sweep drains retries',
      describeDiagram(map),
    ]) {
      expect(prompt).toContain(part);
    }
  });
});

describe('parseJudgement', () => {
  it('reads the last block’s answer, each mechanism’s verdict, the rating and the reason', () => {
    const text = `${judgement({ ...clean, rating: 'poor' })}\n${judgement(clean)}`;
    expect(parseJudgement(text, 2)).toEqual({
      judgement: {
        answer: clean.answer,
        mechanisms: ['yes', 'partly'],
        rating: 'usable',
        reason: clean.reason,
      },
      problems: [],
    });
  });

  it('gives no judgement, and says why, for anything short of a clean one', () => {
    expect(parseJudgement('no block', 2)).toEqual({
      judgement: null,
      problems: ['no <diagram_judgement> block in the answer'],
    });
    expect(parseJudgement(judgement({ ...clean, rating: 'fine' }), 2).problems).toEqual([
      'rating "fine" is not good, usable or poor',
    ]);
    expect(parseJudgement(judgement(clean), 3).problems).toEqual(['2 mechanisms judged, not 3']);
    expect(
      parseJudgement(
        judgement({ ...clean, reason: ' ', mechanisms: [{ shown: 'maybe' }, { shown: 'no' }] }),
        2,
      ),
    ).toEqual({
      judgement: null,
      problems: ['no reason', 'mechanisms[0] is not yes, partly or no'],
    });
  });
});

/** Answers every query with `answer`, recording each call's prompt and options. */
function fakeQuery(answer: string): SdkQueryFn & { calls: { prompt: string; options: Options }[] } {
  const calls: { prompt: string; options: Options }[] = [];
  const query: SdkQueryFn = ({ prompt, options }) => {
    calls.push({ prompt, options });
    const messages = [
      { type: 'assistant', message: { content: [{ type: 'text', text: answer }] } },
      { type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0.02 },
    ] as unknown as SDKMessage[];
    return (async function* () {
      for (const message of messages) await Promise.resolve(yield message);
    })();
  };
  return Object.assign(query, { calls });
}

describe('runJudge', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'er-diagram-judge-'));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  const meta = { exitCode: 0, ms: 1, costUsd: 0.3, turns: 4, failure: null };
  const score: BranchScore = {
    name: 'retry',
    spec,
    samples: [
      {
        sample: 1,
        meta,
        echoes: null,
        review: scoreReview({ overviewDiagram: map, chapters: [] }, [], spec.expect),
      },
      { sample: 2, meta, echoes: null, review: scoreReview({ chapters: [] }, [], spec.expect) },
      { sample: 3, meta: { ...meta, exitCode: 1, failure: 'boom' }, echoes: null, review: null },
    ],
  };

  it('asks each judge about each overview with no tools and one turn, and reads the answers back', async () => {
    const query = fakeQuery(judgement(clean));
    const seen: string[] = [];
    const record = await runJudge(
      { folder, work: overviews([score]), judges: ['judge-a', 'judge-b'], parallel: 2 },
      {
        query,
        onJudged: (judge, branch, sample) => seen.push(`${judge} ${branch} ${String(sample)}`),
      },
    );

    expect(seen.toSorted()).toEqual(['judge-a retry 1', 'judge-b retry 1']);
    expect(query.calls.map((call) => call.options.model).toSorted()).toEqual([
      'judge-a',
      'judge-b',
    ]);
    expect(query.calls[0]?.options).toMatchObject({ tools: [], maxTurns: 1, settingSources: [] });
    expect(query.calls[0]?.prompt).toContain(describeDiagram(map));
    expect(record).toMatchObject({ judges: ['judge-a', 'judge-b'] });
    expect(record.finishedAt).not.toBeNull();

    const judged = await readJudgements(folder, [score]);
    expect(judged.map((item) => [item.judge, item.sample, item.parsed.judgement?.rating])).toEqual([
      ['judge-a', 1, 'usable'],
      ['judge-b', 1, 'usable'],
    ]);
    expect(formatJudged('retry', judged)).toEqual([
      'judged by judge-a: good 0  ·  usable 1  ·  poor 0  ·  mechanisms yes 50% partly 50% no 0%',
      'judged by judge-b: good 0  ·  usable 1  ·  poor 0  ·  mechanisms yes 50% partly 50% no 0%',
    ]);
  });

  it('replaces an earlier judging, and reads a sweep never judged as no judgements', async () => {
    expect(await readJudgements(folder, [score])).toEqual([]);
    await runJudge(
      { folder, work: overviews([score]), judges: ['judge-a'], parallel: 1 },
      { query: fakeQuery(judgement(clean)) },
    );
    await runJudge(
      { folder, work: overviews([score]), judges: ['judge-b'], parallel: 1 },
      { query: fakeQuery('no answer') },
    );
    expect(existsSync(judgementFiles(folder, 'judge-a', 'retry', 1).text)).toBe(false);
    const [only] = await readJudgements(folder, [score]);
    expect(only?.parsed.problems).toEqual(['no <diagram_judgement> block in the answer']);
    expect(formatJudged(null, await readJudgements(folder, [score]))).toEqual([
      'judged by judge-b: good 0  ·  usable 0  ·  poor 0  ·  unreadable 1',
    ]);
    expect(readFileSync(judgementFiles(folder, 'judge-b', 'retry', 1).text, 'utf8')).toBe(
      'no answer',
    );
  });

  it('refuses a judge that is not a model name, before asking anything', async () => {
    const query = fakeQuery(judgement(clean));
    await expect(
      runJudge({ folder, work: overviews([score]), judges: ['../x'], parallel: 1 }, { query }),
    ).rejects.toThrow('a judge is a model name');
    expect(query.calls).toHaveLength(0);
  });
});
