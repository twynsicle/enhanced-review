import type { CitedHunk, DiffChunk, NarrativeChapter, NarrativeReview } from '@/review/narrative';
import { groupSelectedHunks } from '@/report/reader/inline-diff-snippets';

/**
 * How long a chapter takes to read, and how long each reading plan does.
 *
 * Computed here and never written by the model: a model asked for minutes
 * guesses, and a plan whose times do not add up to its own chapters is one a
 * reader stops believing. These constants are the only place a reading speed
 * is stated, so a speed that turns out wrong is changed once.
 */
export const PROSE_WORDS_PER_MINUTE = 200;
export const READ_LINES_PER_MINUTE = 12;
export const SKIM_LINES_PER_MINUTE = 40;
/**
 * One folded row, judged from its reasons. The reader folds a run of adjacent
 * mechanical hunks to a single row, so the run costs this once however many
 * hunks it holds.
 */
export const MECHANICAL_SECONDS = 5;
export const DIAGRAM_SECONDS = 30;

function words(text: string | undefined): number {
  if (text === undefined) return 0;
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

function proseSeconds(texts: readonly (string | undefined)[]): number {
  const total = texts.reduce((sum, text) => sum + words(text), 0);
  return (total * 60) / PROSE_WORDS_PER_MINUTE;
}

/** The longer of a hunk's two spans: what the reader's eye has to cover on the busier side. */
export function hunkLines(hunk: CitedHunk): number {
  return Math.max(hunk.original.lineCount, hunk.modified.lineCount);
}

export function hunkSeconds(hunk: CitedHunk): number {
  switch (hunk.tier) {
    case 'read':
      return (hunkLines(hunk) * 60) / READ_LINES_PER_MINUTE;
    case 'skim':
      return (hunkLines(hunk) * 60) / SKIM_LINES_PER_MINUTE;
    case 'mechanical':
      return MECHANICAL_SECONDS;
  }
}

/** A chunk grouped the way its diff card draws it, so each folded row is charged once. */
function chunkSeconds(chunk: DiffChunk): number {
  return groupSelectedHunks(chunk.hunks).reduce(
    (sum, group) =>
      sum +
      (group[0]?.tier === 'mechanical'
        ? MECHANICAL_SECONDS
        : group.reduce((lines, hunk) => lines + hunkSeconds(hunk), 0)),
    0,
  );
}

export function chapterSeconds(chapter: NarrativeChapter): number {
  const prose = proseSeconds([
    chapter.description?.lede,
    chapter.description?.body,
    ...chapter.insights.map((insight) => insight.text),
  ]);
  const code = chapter.diffChunks.reduce((sum, chunk) => sum + chunkSeconds(chunk), 0);
  return prose + code + (chapter.diagram ? DIAGRAM_SECONDS : 0);
}

/**
 * Up to whole minutes, and never fewer than one: "~0 min" would read as
 * permission to skip. Taken to the second first, so the residue of adding
 * fractions cannot tip an exact minute into the next one.
 */
export function wholeMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(Math.round(seconds) / 60));
}

export function chapterMinutes(chapter: NarrativeChapter): number {
  return wholeMinutes(chapterSeconds(chapter));
}

/** The summary's overview, which every plan opens with. */
export function overviewMinutes(review: NarrativeReview): number {
  const prose = proseSeconds([review.overviewSummary.lede, review.overviewSummary.body]);
  return wholeMinutes(prose + (review.overviewDiagram ? DIAGRAM_SECONDS : 0));
}

export function formatMinutes(minutes: number): string {
  return `~${String(minutes)} min`;
}

export interface PlanRow {
  name: 'Brief' | 'Standard' | 'Full';
  /** The whole plan: the overview and every chapter in it, including the shorter plans' chapters. */
  minutes: number;
  /** Only the chapters this plan adds to the one before it, in chapter order. */
  adds: NarrativeChapter[];
}

/**
 * The three plans, shortest first, or none when the review carries no plan.
 *
 * A plan's minutes are the sum of its chapters' own rounded estimates, the
 * numbers their headers show, so a reader who adds them up gets the plan's
 * total rather than a figure a minute or two off it.
 */
export function readingPlanRows(review: NarrativeReview): PlanRow[] {
  const plan = review.readingPlan;
  if (!plan) return [];
  const overview = overviewMinutes(review);
  const brief = new Set(plan.brief);
  const standard = new Set([...plan.brief, ...plan.standard]);
  const minutesOf = (chapters: readonly NarrativeChapter[]): number =>
    chapters.reduce((sum, chapter) => sum + chapterMinutes(chapter), overview);
  const inBrief = review.chapters.filter((chapter) => brief.has(chapter.id));
  const inStandard = review.chapters.filter((chapter) => standard.has(chapter.id));
  return [
    { name: 'Brief', minutes: minutesOf(inBrief), adds: inBrief },
    {
      name: 'Standard',
      minutes: minutesOf(inStandard),
      adds: inStandard.filter((chapter) => !brief.has(chapter.id)),
    },
    {
      name: 'Full',
      minutes: minutesOf(review.chapters),
      adds: review.chapters.filter((chapter) => !standard.has(chapter.id)),
    },
  ];
}
