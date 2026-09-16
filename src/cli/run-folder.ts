import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReviewMeta } from '../domain/review/review-meta.ts';

/**
 * Where a run keeps its stage files:
 * `<repo root>/er-reviews/<slug>/<yyyymmdd-hhmmss>/`. The `er-reviews`
 * folder ignores itself, so it never shows up in the repository's status and
 * the reviewed repository needs no `.gitignore` entry.
 */
export const RUNS_DIR = 'er-reviews';

const STAMP_RE = /^\d{8}-\d{6}(-\d+)?$/;

export interface RunFiles {
  folder: string;
  context: string;
  /** One `<path>.diff` per reviewed file, hunk ids marked. */
  diffDir: string;
  /** The PR description, when there is one. */
  pr: string;
  system: string;
  prompt: string;
  raw: string;
  /** One line per SDK message from a model run: tools used, how it ended. */
  events: string;
  review: string;
  html: string;
}

export function runFiles(folder: string): RunFiles {
  return {
    folder,
    context: path.join(folder, 'context.json'),
    diffDir: path.join(folder, 'context', 'diff'),
    pr: path.join(folder, 'context', 'pr.md'),
    system: path.join(folder, 'system.md'),
    prompt: path.join(folder, 'prompt.md'),
    raw: path.join(folder, 'raw.txt'),
    events: path.join(folder, 'events.jsonl'),
    review: path.join(folder, 'review.json'),
    html: path.join(folder, 'review.html'),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local time, sortable: `20260911-143005`. */
export function runStamp(date: Date): string {
  return (
    `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** A new, empty run folder; a second run in the same second gets a `-2` suffix. */
export async function createRunFolder(
  repoRoot: string,
  slug: string,
  now: Date,
): Promise<RunFiles> {
  const runs = path.join(repoRoot, RUNS_DIR);
  await mkdir(path.join(runs, slug), { recursive: true });
  await writeFile(path.join(runs, '.gitignore'), '# Written by er: local review runs.\n*\n');
  const stamp = runStamp(now);
  for (let attempt = 1; ; attempt += 1) {
    const folder = path.join(runs, slug, attempt === 1 ? stamp : `${stamp}-${String(attempt)}`);
    try {
      await mkdir(folder);
      return runFiles(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** The newest run folder for a slug, or null when there is none. */
export async function latestRunFolder(repoRoot: string, slug: string): Promise<RunFiles | null> {
  let names: string[];
  try {
    names = await readdir(path.join(repoRoot, RUNS_DIR, slug));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const latest = names
    .filter((name) => STAMP_RE.test(name))
    .toSorted(compareStamps)
    .at(-1);
  return latest ? runFiles(path.join(repoRoot, RUNS_DIR, slug, latest)) : null;
}

function compareStamps(a: string, b: string): number {
  const [aStamp, aRun] = stampKey(a);
  const [bStamp, bRun] = stampKey(b);
  return aStamp.localeCompare(bStamp) || aRun - bRun;
}

/** `20260911-143005-2` → the stamp and the run within that second. */
function stampKey(name: string): [string, number] {
  const cut = name.length > 15 ? name.lastIndexOf('-') : name.length;
  return [name.slice(0, cut), cut === name.length ? 1 : Number(name.slice(cut + 1))];
}

/**
 * Where a reviewed file's hunks go, relative to the diff folder: the file's
 * own path plus `.diff`, with the characters Windows refuses in a file name
 * replaced (a path from a Linux repository may hold them).
 */
export function hunkFileName(filename: string): string {
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what Windows refuses
  return `${filename.replace(/[<>:"|?*\x00-\x1f]/g, '_')}.diff`;
}

/**
 * The name the report gets once it leaves the run folder: `review.html` on
 * its own carries nothing once it is attached to a Slack message or an
 * email, so a PR review is named after the PR it reviewed instead. A branch
 * or staged review has no PR to name it after, so it keeps `review.html`.
 */
export function reportFileName(meta: ReviewMeta): string {
  if (meta.prNumber === null) return 'review.html';
  const title = safeFileNamePart(meta.title);
  return `er-${String(meta.prNumber)}${title ? ` - ${title}` : ''}.html`;
}

/** A string as the readable part of a file name, safe on Windows. */
function safeFileNamePart(text: string): string {
  const trimmed = text.trim().slice(0, 100);
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what Windows refuses
  return trimmed.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}
