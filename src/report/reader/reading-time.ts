import type {
  CitedHunk,
  ContextExcerpt,
  DiffChunk,
  NarrativeChapter,
  NarrativeReview,
} from '@/review/narrative';
import { groupSelectedHunks, hunkLineCount } from '@/report/reader/inline-diff-snippets';
import type { FoldSkim } from '@/report/stores/fold-skim';

/**
 * How long a chapter takes to read, and how long each reading plan does.
 *
 * Computed here and never written by the model: a model asked for minutes
 * guesses, and a plan whose times do not add up to its own chapters is one a
 * reader stops believing. These constants are the only place a reading speed
 * is stated, so a speed that turns out wrong is changed once.
 *
 * The estimate follows the reader's skim preference (`fold-skim.ts`), handed
 * in rather than read here so this stays pure: skim folded is a chapter drawn,
 * and so read, with its skim groups shut.
 */
export const PROSE_WORDS_PER_MINUTE = 200;
export const READ_LINES_PER_MINUTE = 12;
export const SKIM_LINES_PER_MINUTE = 40;
/**
 * One folded row, judged from its reasons. The reader folds a run of adjacent
 * mechanical hunks to a single row, and a run of skim ones when skim is
 * folded, so the run costs this once however many hunks it holds.
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

/** A hunk drawn open; a mechanical one is always folded, so it costs its row. */
export function hunkSeconds(hunk: CitedHunk): number {
  switch (hunk.tier) {
    case 'read':
      return (hunkLineCount(hunk) * 60) / READ_LINES_PER_MINUTE;
    case 'skim':
      return (hunkLineCount(hunk) * 60) / SKIM_LINES_PER_MINUTE;
    case 'mechanical':
      return MECHANICAL_SECONDS;
  }
}

/** A chunk grouped the way its diff card draws it, so each folded row is charged once. */
function chunkSeconds(chunk: DiffChunk, skim: FoldSkim): number {
  return groupSelectedHunks(chunk.hunks).reduce((sum, group) => {
    const tier = group[0]?.tier;
    const folded = tier === 'mechanical' || (tier === 'skim' && skim === 'folded');
    return (
      sum +
      (folded ? MECHANICAL_SECONDS : group.reduce((lines, hunk) => lines + hunkSeconds(hunk), 0))
    );
  }, 0);
}

/** An excerpt of unchanged code is context for the change, not the change, so it is skimmed. */
function excerptSeconds(excerpt: ContextExcerpt): number {
  return ((excerpt.endLine - excerpt.startLine + 1) * 60) / SKIM_LINES_PER_MINUTE;
}

export function chapterSeconds(chapter: NarrativeChapter, skim: FoldSkim): number {
  const excerpts = chapter.contextExcerpts ?? [];
  const prose = proseSeconds([
    chapter.description?.lede,
    chapter.description?.body,
    ...chapter.insights.map((insight) => insight.text),
    ...excerpts.map((excerpt) => excerpt.reason),
  ]);
  const code =
    chapter.diffChunks.reduce((sum, chunk) => sum + chunkSeconds(chunk, skim), 0) +
    excerpts.reduce((sum, excerpt) => sum + excerptSeconds(excerpt), 0);
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

export function chapterMinutes(chapter: NarrativeChapter, skim: FoldSkim): number {
  return wholeMinutes(chapterSeconds(chapter, skim));
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
export function readingPlanRows(review: NarrativeReview, skim: FoldSkim): PlanRow[] {
  const plan = review.readingPlan;
  if (!plan) return [];
  const overview = overviewMinutes(review);
  const brief = new Set(plan.brief);
  const standard = new Set([...plan.brief, ...plan.standard]);
  const minutesOf = (chapters: readonly NarrativeChapter[]): number =>
    chapters.reduce((sum, chapter) => sum + chapterMinutes(chapter, skim), overview);
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
