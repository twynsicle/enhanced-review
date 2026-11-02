import { access, readdir, readFile } from 'node:fs/promises';
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
 *
 * And whether the prompt's own examples leaked into what was drawn. They are
 * there to show a shape, so a label that is an example word for word means
 * the example became a template, and a label carrying an example's word that
 * the change never uses has brought the example's domain into a picture of
 * another one. Both are counted against the examples the run was actually
 * given, read back from its prompt.md.
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
  /** Every piece of text the diagram shows: title, caption and labels. */
  text: string[];
}

/** Diagram text that repeats the prompt's examples, each entry the label or caption as drawn. */
export interface Echoes {
  /** Holds a whole example phrase. */
  copied: string[];
  /** Holds a word of an example that neither the change's files nor its description use. */
  foreign: string[];
}

export interface SampleScore {
  sample: number;
  meta: DiagramSample;
  /** null when er wrote no review, or its prompt gave the diagrams no examples. */
  echoes: Echoes | null;
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
  const base = await treeText(path.join(root, DIAGRAM_CONTRIVED_DIR, 'base'));
  for (const name of sweep.branches) {
    const specDir = path.join(root, DIAGRAM_CONTRIVED_DIR, name);
    const spec = await readDiagramSpec(specDir);
    const { title, description, commit } = spec;
    const files = await treeText(path.join(specDir, 'files'));
    const vocabulary = wordsOf(
      [base, files, title, description, commit.subject, commit.body].join('\n'),
    );
    const samples: SampleScore[] = [];
    for (let sample = 1; sample <= sweep.samples; sample += 1) {
      samples.push(await scoreSample(folder, name, sample, spec.expect, vocabulary));
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
  vocabulary: ReadonlySet<string>,
): Promise<SampleScore> {
  const files = diagramSampleFiles(folder, name, sample);
  const meta = await readDiagramSample(files.meta);
  if (meta.failure !== null) return { sample, meta, echoes: null, review: null };
  const run = runFiles(files.run);
  await access(run.review);
  const review = scoreReview(await readReview(run), await readFindings(run), expect);
  const examples = examplePhrases(await readFile(run.prompt, 'utf8'));
  const text = review.diagrams.flatMap((stats) => stats.text);
  return {
    sample,
    meta,
    echoes: examples === null ? null : findEchoes(text, examples, vocabulary),
    review,
  };
}

/** Every file under a directory, read as text and joined. */
async function treeText(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const texts = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(path.join(entry.parentPath, entry.name), 'utf8')),
  );
  return texts.join('\n');
}

/** The words of a text, lowercased, a camelCase name split into its words. */
function wordsOf(text: string): Set<string> {
  const spaced = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return new Set(spaced.match(/[a-z]+/g) ?? []);
}

/**
 * The quoted phrases of the prompt's Diagram Style section: the examples the
 * run's diagrams were shown. A quoted single word is a field or a value of the
 * schema rather than an example, so only phrases count. null when the prompt
 * has no such section.
 */
export function examplePhrases(prompt: string): string[] | null {
  const section = /^## Diagram Style\n([^]*?)(?=^## |(?![^]))/m.exec(prompt);
  if (!section) return null;
  return [...section[1]!.matchAll(/"([^"\n]+)"/g)]
    .map((match) => match[1]!)
    .filter((phrase) => /\s/.test(phrase));
}

/**
 * One form for a word's inflections, so "Loans" echoes "Loan service" and a
 * label saying "refused" is at home in code that says "refuses". Crude, and
 * only ever compared with itself.
 */
function stem(word: string): string {
  return word
    .replace(/(?:ing|ed|es|s)$/, (ending, at: number) => (at >= 3 ? '' : ending))
    .replace(/e$/, '');
}

// A shorter word is too common to say where it came from.
const MIN_FOREIGN_WORD = 4;

export function findEchoes(
  text: readonly string[],
  examples: readonly string[],
  vocabulary: ReadonlySet<string>,
): Echoes {
  const phrases = examples.map((example) => example.toLowerCase());
  const known = new Set([...vocabulary].map(stem));
  const exampleWords = new Set(
    [...wordsOf(examples.join(' '))]
      .filter((word) => word.length >= MIN_FOREIGN_WORD)
      .map(stem)
      .filter((word) => !known.has(word)),
  );
  return {
    copied: text.filter((item) => phrases.some((phrase) => item.toLowerCase().includes(phrase))),
    foreign: text.filter((item) => [...wordsOf(item)].some((word) => exampleWords.has(stem(word)))),
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
    reached: expect.mustReach.filter((wanted) =>
      [...grounded].some(
        (ground) => ground === wanted || (ground.endsWith('/') && wanted.startsWith(ground)),
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
      text: [
        diagram.title,
        diagram.caption,
        ...diagram.nodes.map((node) => node.label),
        ...(diagram.groups ?? []).map((group) => group.label),
        ...diagram.edges.flatMap((edge) => (edge.label ? [edge.label] : [])),
      ],
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
    text: [
      diagram.title,
      diagram.caption,
      ...diagram.participants.map((p) => p.label),
      ...messages.map((message) => message.label),
      ...groupLabelsOf(diagram.steps),
    ],
  };
}

function groupLabelsOf(steps: readonly Step[]): string[] {
  return steps.flatMap((step): string[] =>
    step.type === 'message'
      ? []
      : [
          ...(step.label ? [step.label] : []),
          ...step.branches.flatMap((branch) => [
            ...(branch.label ? [branch.label] : []),
            ...groupLabelsOf(branch.steps),
          ]),
        ],
  );
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
  const echoed = samples.flatMap((s) => (s.echoes ? [s.echoes] : []));
  if (echoed.length > 0) {
    const copied = echoed.flatMap((e) => e.copied);
    const foreign = echoed.flatMap((e) => e.foreign);
    lines.push(
      `copied examples ${spread(
        echoed.map((e) => e.copied.length),
        count,
      )}` +
        `  ·  example words out of place ${spread(
          echoed.map((e) => e.foreign.length),
          count,
        )}`,
    );
    if (copied.length > 0) lines.push(`  copied: ${tally(copied)}`);
    if (foreign.length > 0) lines.push(`  out of place: ${tally(foreign)}`);
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

/** Each distinct entry quoted once, with how often it came up. */
function tally(items: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts]
    .map(([item, times]) => (times > 1 ? `"${item}" ×${String(times)}` : `"${item}"`))
    .join(', ');
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
  const { echoes } = sample;
  if (echoes && echoes.copied.length > 0)
    parts.push(`copied examples ${String(echoes.copied.length)}`);
  if (echoes && echoes.foreign.length > 0)
    parts.push(`example words out of place ${String(echoes.foreign.length)}`);
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
