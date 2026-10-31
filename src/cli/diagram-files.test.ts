import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Diagram } from '../review/diagram.ts';
import type { NarrativeReview } from '../review/narrative.ts';
import { createTempRepo, GIT_TEST_TIMEOUT, type TempRepo } from '../test/git-repo.ts';
import { checkDiagramFiles } from './diagram-files.ts';
import { Shell } from './git.ts';
import { runGit } from './git-runner.ts';

// Real git, many spawns per test — see GIT_TEST_TIMEOUT.
vi.setConfig({ testTimeout: GIT_TEST_TIMEOUT, hookTimeout: GIT_TEST_TIMEOUT });

let repo: TempRepo;
let shell: Shell;
let head: string;

beforeEach(() => {
  repo = createTempRepo();
  shell = new Shell(repo.work, {
    git: runGit,
    gh: () => Promise.reject(new Error('no gh in tests')),
  });
  repo.write('src/worker/worker.ts', 'export {};\n');
  repo.write('src/orders/create.ts', 'export {};\n');
  head = repo.commit('add the files the diagrams name');
});
afterEach(() => repo.cleanup());

const map: Diagram = {
  id: 'map',
  kind: 'architecture',
  title: 'Map',
  caption: 'Where it sits.',
  direction: 'right',
  nodes: [
    {
      id: 'a',
      label: 'Order intake',
      kind: 'code',
      change: 'modified',
      filename: 'src/orders/create.ts',
    },
    {
      id: 'b',
      label: 'Packing worker',
      kind: 'code',
      change: 'unchanged',
      filename: 'src/worker/worker.ts',
    },
    {
      id: 'c',
      label: 'Retry sweep',
      kind: 'code',
      change: 'unchanged',
      filename: 'src/worker/sweep.ts',
    },
    { id: 'd', label: 'Worker folder', kind: 'code', change: 'unchanged', filename: 'src/worker' },
  ],
  edges: [],
};

const flow: Diagram = {
  id: 'flow',
  kind: 'sequence',
  title: 'Flow',
  caption: 'One pass.',
  participants: [
    {
      id: 'w',
      label: 'Packing worker',
      kind: 'code',
      change: 'unchanged',
      filename: 'src/worker/worker.ts',
    },
    {
      id: 's',
      label: 'Retry sweep',
      kind: 'code',
      change: 'unchanged',
      filename: 'src/worker/sweep.ts',
    },
  ],
  steps: [
    { type: 'message', from: 'w', to: 's', label: 'hand off', style: 'call', change: 'unchanged' },
  ],
};

function review(overviewDiagram: Diagram | undefined, diagram?: Diagram): NarrativeReview {
  return {
    prTitle: 't',
    overviewStyles: ['narrative'],
    overviewSummary: { lede: 's' },
    ...(overviewDiagram ? { overviewDiagram } : {}),
    chapters: [
      {
        id: 'c1',
        title: 'C',
        headline: 'A headline.',
        insights: [],
        diffChunks: [],
        ...(diagram ? { diagram } : {}),
      },
    ],
  };
}

describe('diagram files held to the head commit', () => {
  it('keeps a file the head commit has, and drops a path it does not or that is a folder', async () => {
    const checked = await checkDiagramFiles(
      review(map, flow),
      head,
      ['src/orders/create.ts'],
      shell,
    );
    const overview = checked.review.overviewDiagram;
    expect(overview && 'nodes' in overview ? overview.nodes.map((n) => n.filename) : []).toEqual([
      'src/orders/create.ts',
      'src/worker/worker.ts',
      undefined,
      undefined,
    ]);
    const chapter = checked.review.chapters[0]?.diagram;
    expect(
      chapter && 'participants' in chapter ? chapter.participants.map((p) => p.filename) : [],
    ).toEqual(['src/worker/worker.ts', undefined]);
    expect(checked.dropped.map((f) => [f.code, f.message])).toEqual([
      [
        'diagram-part-dropped',
        'Diagram map dropped src/worker/sweep.ts, src/worker, not files at the head commit.',
      ],
      [
        'diagram-part-dropped',
        'Diagram flow dropped src/worker/sweep.ts, not a file at the head commit.',
      ],
    ]);
  });

  it('reads no git when every filename is a changed file', async () => {
    const noGit = new Shell(repo.work, {
      git: () => Promise.reject(new Error('git was asked')),
      gh: () => Promise.reject(new Error('no gh in tests')),
    });
    const kept = review(undefined, flow);
    const checked = await checkDiagramFiles(
      kept,
      head,
      ['src/worker/worker.ts', 'src/worker/sweep.ts'],
      noGit,
    );
    expect(checked).toEqual({ review: kept, dropped: [] });
  });
});
