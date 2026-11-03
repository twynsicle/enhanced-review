import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RATINGS, RatingsFileSchema, type Rating } from '../report/sheet/sheet-data.ts';
import type { JudgedOverview } from './diagram-judge.ts';

/**
 * Whether a judge can stand in for the user: its ratings of a sweep's
 * overviews against the ones the user gave on the contact sheet, and the two
 * judges against each other. Raw agreement flatters a sweep that is mostly
 * "good", so Cohen's kappa sits beside it, and every disagreement is listed
 * with the judge's reason, since the reasons are where a rubric gets fixed.
 */
export const RATINGS_FILE = 'ratings.json';

/** Ratings by overview, keyed by `ratedKey`. */
export type Rated = Map<string, Rating>;

export const ratedKey = (branch: string, sample: number) => `${branch} sample ${String(sample)}`;

/** The user's ratings of this sweep, from the ratings.json saved into its folder. */
export async function readUserRatings(sweep: string): Promise<Rated> {
  const file = path.join(sweep, RATINGS_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(
      `${file} does not exist: rate the overviews on this sweep's contact sheet, download the ratings, and save them there`,
      { cause: error },
    );
  }
  const parsed = RatingsFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${file} is not a ratings file: ${parsed.error.message}`);
  const stamp = path.basename(sweep);
  const rated: Rated = new Map();
  for (const item of parsed.data.ratings) {
    if (item.stamp === stamp) rated.set(ratedKey(item.branch, item.sample), item.rating);
  }
  if (rated.size === 0) throw new Error(`${file} rates nothing in sweep ${stamp}`);
  return rated;
}

/** One judge's ratings; an answer it gave no clean judgement in is left out. */
export function judgeRatings(judged: readonly JudgedOverview[], judge: string): Rated {
  const rated: Rated = new Map();
  for (const item of judged) {
    if (item.judge === judge && item.parsed.judgement) {
      rated.set(ratedKey(item.branch, item.sample), item.parsed.judgement.rating);
    }
  }
  return rated;
}

/** One judge's reasons, to show beside a disagreement. */
export function judgeReasons(
  judged: readonly JudgedOverview[],
  judge: string,
): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const item of judged) {
    if (item.judge === judge && item.parsed.judgement) {
      reasons.set(ratedKey(item.branch, item.sample), item.parsed.judgement.reason);
    }
  }
  return reasons;
}

export interface Agreement {
  first: string;
  second: string;
  /** Overviews both rated. */
  compared: number;
  exact: number;
  /** Good beside usable, or usable beside poor; never good beside poor. */
  withinOne: number;
  /** null when chance alone would agree on every overview, which leaves kappa undefined. */
  kappa: number | null;
  disagreements: { key: string; first: Rating; second: Rating }[];
}

const step = (rating: Rating) => RATINGS.indexOf(rating);

export function agreement(first: string, a: Rated, second: string, b: Rated): Agreement {
  const keys = [...a.keys()].filter((key) => b.has(key)).toSorted();
  const pairs = keys.map((key) => ({ key, first: a.get(key)!, second: b.get(key)! }));
  const n = pairs.length;
  const exact = pairs.filter((pair) => pair.first === pair.second).length;
  const chance = RATINGS.reduce((sum, rating) => {
    const inA = pairs.filter((pair) => pair.first === rating).length;
    const inB = pairs.filter((pair) => pair.second === rating).length;
    return sum + (n === 0 ? 0 : (inA / n) * (inB / n));
  }, 0);
  return {
    first,
    second,
    compared: n,
    exact,
    withinOne: pairs.filter((pair) => Math.abs(step(pair.first) - step(pair.second)) <= 1).length,
    kappa: n === 0 || chance === 1 ? null : (exact / n - chance) / (1 - chance),
    disagreements: pairs.filter((pair) => pair.first !== pair.second),
  };
}

export function formatAgreement(
  result: Agreement,
  reasons?: ReadonlyMap<string, string>,
): string[] {
  const { first, second, compared, exact, withinOne, kappa } = result;
  if (compared === 0) return [`${first} and ${second} rated no overview in common`];
  const percent = (part: number) => `${String(Math.round((part / compared) * 100))}%`;
  return [
    `${first} and ${second}, ${String(compared)} overviews: agree ${percent(exact)}  ·  within one ${percent(withinOne)}` +
      `  ·  kappa ${kappa === null ? 'undefined' : kappa.toFixed(2)}`,
    ...result.disagreements.map(
      (item) =>
        `  ${item.key}: ${first} ${item.first}, ${second} ${item.second}` +
        (reasons?.has(item.key) ? ` (${reasons.get(item.key)!})` : ''),
    ),
  ];
}
