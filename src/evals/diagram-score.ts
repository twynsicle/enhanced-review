import { access } from 'node:fs/promises';
import path from 'node:path';
import { readFindings, readReview } from '../cli/parse.ts';
import { runFiles } from '../cli/run-folder.ts';
import {
  isGraphDiagram,
  type Diagram,
  type DiagramKind,
  type SequenceLeafGroup,
  type SequenceMessage,
  type SequenceStep,
} from '../review/diagram.ts';
import type { Finding } from '../review/findings.ts';
import type { NarrativeReview } from '../review/narrative.ts';
import {
  branchDigest,
  DIAGRAM_CONTRIVED_DIR,
  readDiagramSpec,
  type DiagramBranchSpec,
  type Expect,
} from './diagram-case.ts';
import {
  diagramSampleFiles,
  readDiagramSample,
  readDiagramSweep,
  type DiagramSample,
} from './diagram-run.ts';
import { spread } from './skim-score.ts';

/**
 * Tier 0 of the diagram eval: what can be counted without judging a picture.
 * Whether the diagrams a change deserves were drawn, and nothing where it
 * deserves none; and, of what was drawn, how much is the untouched system
 * around the change, how much is named by an identifier rather than by what
 * it does, and how much of it the parser had to drop. Whether a picture is
 * any good is the contact sheet's question, answered by eye.
 */

/** One diagram's counts. A sequence's participants are its nodes and its messages its edges. */
export interface DiagramStats {
  /** `overview`, or the title of the chapter that carries it. */
  where: string;
  kind: DiagramKind;
  diagram: Diagram;
  nodes: number;
  unchanged: number;
  identifierLabels: number;
  edges: number;
  labelledEdges: number;
  /** Every node's grounding path, for the files a mechanism map should reach. */
  filenames: string[];
}

export interface SampleScore {
  sample: number;
  meta: DiagramSample;
  /** null when er wrote no review; every other field is then empty. */
  review: {
    overview: { kind: DiagramKind | null; ok: boolean };
    chapters: { kinds: DiagramKind[]; ok: boolean };
    onTarget: boolean;
    /** Fewer diagrams than deserved: the error that costs a reader most, beside which an extra one is cheap. */
    missed: boolean;
    diagrams: DiagramStats[];
    reached: string[];
    /** Whole diagrams and parts of them the parser dropped. */
    drops: number;
    retried: boolean;
  } | null;
}

export interface BranchScore {
  name: string;
  spec: DiagramBranchSpec;
  samples: SampleScore[];
}

export async function scoreDiagramSweep(folder: string, root: string): Promise<BranchScore[]> {
  const sweep = await readDiagramSweep(folder);
  const changed: string[] = [];
  for (const name of sweep.branches) {
    if ((await branchDigest(root, name)) !== sweep.digests[name]) changed.push(name);
  }
  if (changed.length > 0) {
    throw new Error(
      `${changed.join(', ')} changed since this sweep, so its answers are about another change; sweep again`,
    );
  }
  const scores: BranchScore[] = [];
  for (const name of sweep.branches) {
    const spec = await readDiagramSpec(path.join(root, DIAGRAM_CONTRIVED_DIR, name));
    const samples: SampleScore[] = [];
    for (let sample = 1; sample <= sweep.samples; sample += 1) {
      samples.push(await scoreSample(folder, name, sample, spec.expect));
    }
    scores.push({ name, spec, samples });
  }
  return scores;
}

async function scoreSample(
  folder: string,
  name: string,
  sample: number,
  expect: Expect,
): Promise<SampleScore> {
  const files = diagramSampleFiles(folder, name, sample);
  const meta = await readDiagramSample(files.meta);
  if (meta.failure !== null) return { sample, meta, review: null };
  const run = runFiles(files.run);
  await access(run.review);
  return {
    sample,
    meta,
    review: scoreReview(await readReview(run), await readFindings(run), expect),
  };
}

export function scoreReview(
  review: Pick<NarrativeReview, 'overviewDiagram' | 'chapters'>,
  findings: readonly Finding[],
  expect: Expect,
): NonNullable<SampleScore['review']> {
  const overviewKind = review.overviewDiagram?.kind ?? null;
  const overviewOk =
    expect.overview === null
      ? overviewKind === null
      : overviewKind !== null && expect.overview.kinds.includes(overviewKind);
  const chapterDiagrams = review.chapters.flatMap((chapter) =>
    chapter.diagram ? [{ where: chapter.title, diagram: chapter.diagram }] : [],
  );
  const chapterKinds = chapterDiagrams.map(({ diagram }) => diagram.kind);
  const { min, max, kinds } = expect.chapterDiagrams;
  const chaptersOk =
    chapterKinds.length >= min &&
    chapterKinds.length <= max &&
    chapterKinds.every((kind) => kinds.includes(kind));
  const diagrams = [
    ...(review.overviewDiagram ? [diagramStats('overview', review.overviewDiagram)] : []),
    ...chapterDiagrams.map(({ where, diagram }) => diagramStats(where, diagram)),
  ];
  const grounded = new Set(diagrams.flatMap((stats) => stats.filenames));
  return {
    overview: { kind: overviewKind, ok: overviewOk },
    chapters: { kinds: chapterKinds, ok: chaptersOk },
    onTarget: overviewOk && chaptersOk,
    missed: (expect.overview !== null && overviewKind === null) || chapterKinds.length < min,
    diagrams,
    // A node grounded in a folder reaches every file under it.
    reached: expect.mustReach.filter((path) =>
      [...grounded].some(
        (ground) => ground === path || (ground.endsWith('/') && path.startsWith(ground)),
      ),
    ),
    drops: findings.filter(
      (item) => item.code === 'diagram-dropped' || item.code === 'diagram-part-dropped',
    ).length,
    retried: findings.some((item) => item.code === 'passed-after-retry'),
  };
}

export function diagramStats(where: string, diagram: Diagram): DiagramStats {
  if (isGraphDiagram(diagram)) {
    return {
      where,
      kind: diagram.kind,
      diagram,
      nodes: diagram.nodes.length,
      unchanged: diagram.nodes.filter((node) => node.change === 'unchanged').length,
      identifierLabels: diagram.nodes.filter((node) => isIdentifierLabel(node.label)).length,
      edges: diagram.edges.length,
      labelledEdges: diagram.edges.filter((edge) => edge.label !== undefined).length,
      filenames: diagram.nodes.flatMap((node) => (node.filename ? [node.filename] : [])),
    };
  }
  const messages = messagesOf(diagram.steps);
  return {
    where,
    kind: diagram.kind,
    diagram,
    nodes: diagram.participants.length,
    unchanged: diagram.participants.filter((p) => p.change === 'unchanged').length,
    identifierLabels: diagram.participants.filter((p) => isIdentifierLabel(p.label)).length,
    edges: messages.length,
    labelledEdges: messages.length,
    filenames: diagram.participants.flatMap((p) => (p.filename ? [p.filename] : [])),
  };
}

type Step = SequenceStep | SequenceMessage | SequenceLeafGroup;

function messagesOf(steps: readonly Step[]): SequenceMessage[] {
  return steps.flatMap((step): SequenceMessage[] =>
    step.type === 'message' ? [step] : step.branches.flatMap((branch) => messagesOf(branch.steps)),
  );
}

/**
 * A word shaped like code: camelCase, a PascalCase compound, or anything
 * with an underscore, a dot, a slash or a call's brackets. `RetryQueue` and
 * `createOrder` are; `Cardflow gateway` and `placed` are not. A label that
 * carries one is anchored on a name rather than on what the thing does.
 */
const CODE_WORD = /^(?:[a-z]+[A-Z]\w*|[A-Z][a-z0-9]+[A-Z]\w*|\S*[_./]\S*|\S+\(\))$/;

export function isIdentifierLabel(label: string): boolean {
  return label.split(/\s+/).some((word) => CODE_WORD.test(word.replace(/[,:;]$/, '')));
}

const percent = (value: number) => `${String(Math.round(value * 100))}%`;
const count = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

type Reviewed = SampleScore & { review: NonNullable<SampleScore['review']> };

function reviewed(samples: readonly SampleScore[]): Reviewed[] {
  return samples.filter((sample): sample is Reviewed => sample.review !== null);
}

function sum(stats: readonly DiagramStats[], key: keyof DiagramStats): number {
  return stats.reduce((total, item) => total + (item[key] as number), 0);
}

/** One line of figures, each a spread across the samples given. */
function figures(samples: readonly Reviewed[], mustReach: number): string[] {
  const stats = samples.map((sample) => sample.review.diagrams);
  const drawn = stats.map((list) => list.length);
  const lines = [
    `on target ${percent(share(samples.filter((s) => s.review.onTarget).length, samples.length))}` +
      `  ·  overview right ${percent(share(samples.filter((s) => s.review.overview.ok).length, samples.length))}` +
      `  ·  chapters right ${percent(share(samples.filter((s) => s.review.chapters.ok).length, samples.length))}` +
      `  ·  missed one ${percent(share(samples.filter((s) => s.review.missed).length, samples.length))}` +
      `  ·  diagrams ${spread(drawn, count)}`,
  ];
  const withDiagrams = stats.filter((list) => list.length > 0);
  if (withDiagrams.length > 0) {
    lines.push(
      `nodes ${spread(
        withDiagrams.map((list) => sum(list, 'nodes') / list.length),
        count,
      )} a diagram` +
        `  ·  unchanged ${spread(
          withDiagrams.map((list) => share(sum(list, 'unchanged'), sum(list, 'nodes'))),
          percent,
        )}` +
        `  ·  identifier labels ${spread(
          withDiagrams.map((list) => share(sum(list, 'identifierLabels'), sum(list, 'nodes'))),
          percent,
        )}` +
        `  ·  labelled edges ${spread(
          withDiagrams.map((list) => share(sum(list, 'labelledEdges'), sum(list, 'edges'))),
          percent,
        )}`,
    );
  }
  const drops = samples.map((s) => s.review.drops);
  const retries = samples.filter((s) => s.review.retried).length;
  lines.push(
    (mustReach > 0
      ? `reached ${spread(
          samples.map((s) => s.review.reached.length),
          count,
        )} of ${String(mustReach)} untouched files  ·  `
      : '') +
      `parser drops ${spread(drops, count)}  ·  retried ${String(retries)} of ${String(samples.length)}`,
  );
  return lines;
}

/** What a sample drew against what its branch deserved, in one line. */
export function sampleVerdict(sample: SampleScore): string {
  if (sample.review === null) return `FAILED (er exited ${String(sample.meta.exitCode)})`;
  const { overview, chapters, onTarget, missed } = sample.review;
  return (
    `${onTarget ? 'on target' : missed ? 'missed' : 'off'}` +
    `  ·  overview ${overview.kind ?? 'none'}${overview.ok ? '' : ' ✗'}` +
    `  ·  chapters ${chapters.kinds.length === 0 ? 'none' : chapters.kinds.join(', ')}${chapters.ok ? '' : ' ✗'}`
  );
}

/** A sample's counts, in one line; empty for a failed one. */
export function sampleFigures(sample: SampleScore, mustReach: number): string {
  if (sample.review === null) return '';
  const { diagrams, reached, drops, retried } = sample.review;
  const parts: string[] = [];
  if (diagrams.length > 0) {
    parts.push(
      `${String(sum(diagrams, 'nodes'))} nodes`,
      `unchanged ${percent(share(sum(diagrams, 'unchanged'), sum(diagrams, 'nodes')))}`,
      `identifier labels ${percent(share(sum(diagrams, 'identifierLabels'), sum(diagrams, 'nodes')))}`,
      `labelled edges ${percent(share(sum(diagrams, 'labelledEdges'), sum(diagrams, 'edges')))}`,
    );
  }
  if (mustReach > 0) parts.push(`reached ${String(reached.length)} of ${String(mustReach)}`);
  if (drops > 0) parts.push(`${String(drops)} parser drops`);
  if (retried) parts.push('retried');
  if (sample.meta.costUsd !== null) parts.push(`$${sample.meta.costUsd.toFixed(2)}`);
  return parts.join('  ·  ');
}

/** What a branch deserves, in words: `overview architecture, chapter diagrams 0–1 sequence`. */
export function deserved(expect: Expect): string {
  const overview = expect.overview ? expect.overview.kinds.join(' or ') : 'none';
  const { min, max, kinds } = expect.chapterDiagrams;
  const chapters =
    max === 0
      ? 'none'
      : `${min === max ? String(min) : `${String(min)}–${String(max)}`} ${kinds.join(' or ')}`;
  return `overview ${overview}, chapter diagrams ${chapters}`;
}

export function formatBranchScore(score: BranchScore): string[] {
  const { expect } = score.spec;
  const lines = [`${score.name}  ${score.spec.title}`, `  deserves ${deserved(score.spec.expect)}`];
  for (const sample of score.samples)
    lines.push(`  sample ${String(sample.sample)}: ${sampleVerdict(sample)}`);
  const done = reviewed(score.samples);
  if (done.length > 0) lines.push(...figures(done, expect.mustReach.length).map((l) => `  ${l}`));
  return lines;
}

/** Every branch's samples pooled: each figure's spread is across all of them. */
export function formatDiagramOverall(scores: readonly BranchScore[]): string[] {
  const all = scores.flatMap((score) => score.samples);
  const done = reviewed(all);
  const failed = all.length - done.length;
  const reach = scores.reduce((total, score) => total + score.spec.expect.mustReach.length, 0);
  const reached = done.reduce((total, sample) => total + sample.review.reached.length, 0);
  const lines = [
    `all ${String(scores.length)} branches  ·  ${String(all.length)} samples` +
      (failed > 0 ? `  ·  ${String(failed)} FAILED` : ''),
    ...figures(done, 0).map((l) => `  ${l}`),
  ];
  if (reach > 0) {
    const asked = scores.reduce(
      (total, score) =>
        total +
        score.spec.expect.mustReach.length *
          score.samples.filter((sample) => sample.review !== null).length,
      0,
    );
    lines.push(`  reached ${percent(share(reached, asked))} of the untouched files asked for`);
  }
  return lines;
}
