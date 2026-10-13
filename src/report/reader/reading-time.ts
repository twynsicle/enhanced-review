import type {
  CitedHunk,
  ContextExcerpt,
  NarrativeChapter,
  NarrativeReview,
} from '@/review/narrative';

/**
 * How long a chapter takes to read, and how long each reading plan does.
 *
 * Computed here and never written by the model: a model asked for minutes
 * guesses, and a plan whose times do not add up to its own chapters is one a
 * reader stops believing. These constants are the only place a reading speed
 * is stated, so a speed that turns out wrong is changed once.
 */
export const PROSE_WORDS_PER_MINUTE = 200;
/**
 * Changed lines, git's context lines left out. Brisk next to the rates code
 * review studies give for hunting defects, on purpose: this is the time to
 * read a change through once, not to audit every line of it.
 */
export const READ_LINES_PER_MINUTE = 25;
export const SKIM_LINES_PER_MINUTE = 100;
export const DIAGRAM_SECONDS = 30;

function words(text: string | undefined): number {
  if (text === undefined) return 0;
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

function proseSeconds(texts: readonly (string | undefined)[]): number {
  const total = texts.reduce((sum, text) => sum + words(text), 0);
  return (total * 60) / PROSE_WORDS_PER_MINUTE;
}

export function hunkSeconds(hunk: CitedHunk): number {
  const perMinute = hunk.tier === 'read' ? READ_LINES_PER_MINUTE : SKIM_LINES_PER_MINUTE;
  return (hunk.changedLines * 60) / perMinute;
}

/** An excerpt of unchanged code is context for the change, not the change, so it is skimmed. */
function excerptSeconds(excerpt: ContextExcerpt): number {
  return ((excerpt.endLine - excerpt.startLine + 1) * 60) / SKIM_LINES_PER_MINUTE;
}

export function chapterSeconds(chapter: NarrativeChapter): number {
  const excerpts = chapter.contextExcerpts ?? [];
  const prose = proseSeconds([
    chapter.description?.lede,
    chapter.description?.body,
    ...chapter.insights.map((insight) => insight.text),
    ...excerpts.map((excerpt) => excerpt.reason),
  ]);
  const code =
    chapter.diffChunks.reduce(
      (sum, chunk) => sum + chunk.hunks.reduce((lines, hunk) => lines + hunkSeconds(hunk), 0),
      0,
    ) + excerpts.reduce((sum, excerpt) => sum + excerptSeconds(excerpt), 0);
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

function overviewSeconds(review: NarrativeReview): number {
  const prose = proseSeconds([review.overviewSummary.lede, review.overviewSummary.body]);
  return prose + (review.overviewDiagram ? DIAGRAM_SECONDS : 0);
}

/** The summary's overview, which every plan opens with. */
export function overviewMinutes(review: NarrativeReview): number {
  return wholeMinutes(overviewSeconds(review));
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
 * A plan's minutes are its chapters' seconds and the overview's, rounded
 * once. Summing the headers' rounded figures instead charges every chapter up
 * to a minute it does not take, and a review of forty chapters forty minutes.
 */
export function readingPlanRows(review: NarrativeReview): PlanRow[] {
  const plan = review.readingPlan;
  if (!plan) return [];
  const overview = overviewSeconds(review);
  const brief = new Set(plan.brief);
  const standard = new Set([...plan.brief, ...plan.standard]);
  const minutesOf = (chapters: readonly NarrativeChapter[]): number =>
    wholeMinutes(chapters.reduce((sum, chapter) => sum + chapterSeconds(chapter), overview));
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
