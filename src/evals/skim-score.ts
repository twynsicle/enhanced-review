import { MAX_SKIM_REASON } from '../review/narrative.ts';
import type { ParsedAnswer } from './skim-answer.ts';
import type { Label, SkimCase } from './skim-case.ts';

/**
 * How a set of samples did against a case's labels. The two kinds of error
 * are kept apart because the prompt weighs them apart: skimming a hunk a
 * reviewer had to read hides the change, reading one they could have skimmed
 * costs them a minute. One number for both would let a prompt trade the first
 * for the second and look better for it.
 *
 * Every figure is per sample, and the case and the sweep report each as a
 * mean with its spread, since a change to the prompt is real only when it
 * moves a figure outside the spread the same prompt already shows.
 */
export interface Tally {
  judged: number;
  agreed: number;
  /** Labelled read, model said skim: the error that hides the change. */
  skimmedRead: number;
  /** Labelled skim, model said read: the error that wastes a minute. */
  readSkim: number;
  /** Labelled, but the answer never tiered it. */
  missing: number;
}

export interface SampleScore extends Tally {
  byCategory: Record<string, Tally>;
  /** Of the judged hunks the model tiered, the share it skimmed. */
  modelSkimRate: number;
  /** Skim reasons past the reader's label limit, which the parser would drop. */
  longReasons: number;
  problems: string[];
}

export interface Disagreement {
  id: string;
  file: string;
  header: string;
  category: string;
  label: 'read' | 'skim';
  modelRead: number;
  modelSkim: number;
  missing: number;
  /** The skim reasons the model gave, each once. */
  reasons: string[];
}

export interface CaseScore {
  name: string;
  title: string;
  hunks: number;
  judged: number;
  proven: number;
  either: number;
  /** Rows nobody has judged yet: a tier the import seeded, with no category. */
  unlabelled: number;
  /** Of the judged hunks, the share labelled skim. */
  labelSkimRate: number;
  samples: SampleScore[];
  /** Judged hunks the model got wrong in at least half the samples. */
  disagreements: Disagreement[];
}

function emptyTally(): Tally {
  return { judged: 0, agreed: 0, skimmedRead: 0, readSkim: 0, missing: 0 };
}

type Judged = Label & { tier: 'read' | 'skim'; category: string };

/** The labels the scorer judges: a person said read or skim, and gave the category that says so. */
function judgedLabels(labels: readonly Label[]): Judged[] {
  return labels.filter(
    (label): label is Judged =>
      (label.tier === 'read' || label.tier === 'skim') && label.category !== undefined,
  );
}

export function scoreSample(labels: readonly Label[], answer: ParsedAnswer): SampleScore {
  const total = emptyTally();
  const byCategory: Record<string, Tally> = {};
  let answered = 0;
  let skimmed = 0;
  let longReasons = 0;
  for (const label of judgedLabels(labels)) {
    const tally = (byCategory[label.category] ??= emptyTally());
    const given = answer.tiers.get(label.id);
    for (const t of [total, tally]) {
      t.judged += 1;
      if (!given) t.missing += 1;
      else if (given.tier === label.tier) t.agreed += 1;
      else if (label.tier === 'read') t.skimmedRead += 1;
      else t.readSkim += 1;
    }
    if (given) {
      answered += 1;
      if (given.tier === 'skim') skimmed += 1;
      if (given.skimReason && given.skimReason.length > MAX_SKIM_REASON) longReasons += 1;
    }
  }
  return {
    ...total,
    byCategory,
    modelSkimRate: answered === 0 ? 0 : skimmed / answered,
    longReasons,
    problems: answer.problems,
  };
}

export function scoreCase(
  skimCase: SkimCase,
  labels: readonly Label[],
  answers: readonly ParsedAnswer[],
): CaseScore {
  const judged = judgedLabels(labels);
  const samples = answers.map((answer) => scoreSample(labels, answer));
  const disagreements: Disagreement[] = [];
  for (const label of judged) {
    let modelRead = 0;
    let modelSkim = 0;
    let missing = 0;
    const reasons = new Set<string>();
    for (const answer of answers) {
      const given = answer.tiers.get(label.id);
      if (!given) missing += 1;
      else if (given.tier === 'read') modelRead += 1;
      else {
        modelSkim += 1;
        if (given.skimReason) reasons.add(given.skimReason);
      }
    }
    const wrong = missing + (label.tier === 'read' ? modelSkim : modelRead);
    if (wrong > 0 && wrong * 2 >= answers.length) {
      disagreements.push({
        id: label.id,
        file: label.file,
        header: label.header,
        category: label.category,
        label: label.tier,
        modelRead,
        modelSkim,
        missing,
        reasons: [...reasons],
      });
    }
  }
  return {
    name: skimCase.name,
    title: skimCase.title,
    hunks: labels.length,
    judged: judged.length,
    proven: labels.filter((label) => label.tier === 'proven').length,
    either: labels.filter((label) => label.tier === 'either').length,
    unlabelled: labels.filter(
      (label) => (label.tier === 'read' || label.tier === 'skim') && label.category === undefined,
    ).length,
    labelSkimRate:
      judged.length === 0
        ? 0
        : judged.filter((label) => label.tier === 'skim').length / judged.length,
    samples,
    disagreements,
  };
}

/** `mean (min–max)` over the samples, or the one value when they agree. */
export function spread(values: readonly number[], format: (value: number) => string): string {
  if (values.length === 0) return '–';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (min === max) return format(mean);
  return `${format(mean)} (${format(min)}–${format(max)})`;
}

const percent = (value: number) => `${String(Math.round(value * 100))}%`;
const count = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function agreeRate(tally: Tally): number {
  return tally.judged === 0 ? 0 : tally.agreed / tally.judged;
}

/** One table row: a tally's figures across the samples. */
function tallyRow(name: string, tallies: readonly Tally[]): string {
  const judged = tallies[0]?.judged ?? 0;
  return [
    name.padEnd(18),
    String(judged).padStart(5),
    spread(tallies.map(agreeRate), percent).padStart(16),
    spread(
      tallies.map((t) => t.skimmedRead),
      count,
    ).padStart(14),
    spread(
      tallies.map((t) => t.readSkim),
      count,
    ).padStart(12),
    spread(
      tallies.map((t) => t.missing),
      count,
    ).padStart(9),
  ].join('  ');
}

const HEADER = [
  'category'.padEnd(18),
  'hunks'.padStart(5),
  'agree'.padStart(16),
  'skimmed read'.padStart(14),
  'read skim'.padStart(12),
  'missing'.padStart(9),
].join('  ');

export function formatCaseScore(score: CaseScore): string[] {
  const lines = [
    `${score.name}  ${score.title}`,
    `  ${String(score.hunks)} hunks: ${String(score.judged)} judged, ${String(score.proven)} proven, ${String(score.either)} either, ${String(score.unlabelled)} unlabelled  ·  ${String(score.samples.length)} samples`,
    `  ${HEADER}`,
  ];
  const categories = new Set(score.samples.flatMap((sample) => Object.keys(sample.byCategory)));
  for (const category of [...categories].toSorted()) {
    lines.push(
      `  ${tallyRow(
        category,
        score.samples.map((sample) => sample.byCategory[category] ?? emptyTally()),
      )}`,
    );
  }
  lines.push(`  ${tallyRow('all', score.samples)}`);
  lines.push(
    `  skim rate  model ${spread(
      score.samples.map((sample) => sample.modelSkimRate),
      percent,
    )}  ·  labels ${percent(score.labelSkimRate)}`,
  );
  const longReasons = score.samples.reduce((sum, sample) => sum + sample.longReasons, 0);
  if (longReasons > 0) {
    lines.push(`  ${String(longReasons)} skim reasons over ${String(MAX_SKIM_REASON)} characters`);
  }
  const problems = score.samples.flatMap((sample, index) =>
    sample.problems.map((problem) => `    sample ${String(index + 1)}: ${problem}`),
  );
  if (problems.length > 0) lines.push('  answer problems:', ...problems);
  if (score.disagreements.length > 0) {
    const half = Math.ceil(score.samples.length / 2);
    lines.push(`  wrong in ${String(half)}+ of ${String(score.samples.length)} samples:`);
    for (const d of score.disagreements) {
      const model = [
        d.modelRead > 0 ? `read ×${String(d.modelRead)}` : null,
        d.modelSkim > 0 ? `skim ×${String(d.modelSkim)}` : null,
        d.missing > 0 ? `missing ×${String(d.missing)}` : null,
      ]
        .filter((part) => part !== null)
        .join(', ');
      const reasons = d.reasons.length > 0 ? `  “${d.reasons.join('” / “')}”` : '';
      lines.push(
        `    ${d.id}  ${d.file}  ${d.header}  [${d.category}]  label ${d.label}  ·  model ${model}${reasons}`,
      );
    }
  }
  return lines;
}

/**
 * Every case pooled, sample by sample: the k-th sample of each case makes one
 * sweep-wide sample, so the spread is still across runs of the same prompt.
 */
export function formatOverall(scores: readonly CaseScore[]): string[] {
  const samples = Math.min(...scores.map((score) => score.samples.length));
  if (scores.length === 0 || !Number.isFinite(samples) || samples === 0) return [];
  const pooled: Tally[] = Array.from({ length: samples }, (_, k) => {
    const tally = emptyTally();
    for (const score of scores) {
      const sample = score.samples[k]!;
      tally.judged += sample.judged;
      tally.agreed += sample.agreed;
      tally.skimmedRead += sample.skimmedRead;
      tally.readSkim += sample.readSkim;
      tally.missing += sample.missing;
    }
    return tally;
  });
  return [
    `all ${String(scores.length)} cases  ·  ${String(samples)} samples each`,
    `  ${HEADER}`,
    `  ${tallyRow('all', pooled)}`,
  ];
}
