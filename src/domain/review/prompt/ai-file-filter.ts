import type { ReviewFileSkipReason } from '../narrative.ts';

/**
 * Files that never reach the model: lockfiles, minified bundles, source maps
 * and snapshots. They still count in the Files Changed list the reader shows.
 */
const EXACT_FILENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'flake.lock',
  'bun.lockb',
  'bun.lock',
  'go.sum',
  'shrinkwrap.json',
  'npm-shrinkwrap.json',
]);

const EXCLUDED_EXTENSIONS: readonly string[] = ['.snap', '.min.js', '.min.css', '.map', '.lock'];

const EXCLUDED_PATH_SEGMENTS: readonly string[] = ['__snapshots__/'];

export function isExcludedFromAI(filename: string, userPatterns?: readonly string[]): boolean {
  const lower = filename.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;

  if (EXACT_FILENAMES.has(basename)) return true;
  if (EXCLUDED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  if (EXCLUDED_PATH_SEGMENTS.some((segment) => lower.includes(segment))) return true;

  if (userPatterns) {
    for (const pattern of userPatterns) {
      const p = pattern.toLowerCase();
      if (basename === p || lower.endsWith(p) || lower.includes(p)) return true;
    }
  }
  return false;
}

/** The built-in list as a skip reason, or null when the path is none of it. */
export function builtInSkipReason(
  filename: string,
  userPatterns?: readonly string[],
): ReviewFileSkipReason | null {
  return isExcludedFromAI(filename, userPatterns) ? 'built-in' : null;
}

/** Binary as a skip reason: git has no text hunks to put in front of the model. */
export function binarySkipReason(binary: boolean): ReviewFileSkipReason | null {
  return binary ? 'binary' : null;
}

/**
 * Why a changed file is left out of the review, from the file alone, or null
 * when it goes to the model. This is the one decision: `buildNarrativePrompt`
 * lists exactly the files no reason applies to, so what the reader dims and
 * what the model is asked about cannot disagree.
 *
 * The local CLI layers the repository's own `.gitattributes` between the two
 * rules — `generated` and `vendored` need a `git check-attr` at the head,
 * which the hosted path does not run — so it calls them separately in that
 * order rather than going through here.
 */
export function promptSkipReason(
  file: { filename: string; binary: boolean },
  userPatterns?: readonly string[],
): ReviewFileSkipReason | null {
  return builtInSkipReason(file.filename, userPatterns) ?? binarySkipReason(file.binary);
}

/** The same rules as globs, for tools that take deny patterns. */
export function builtInDenyGlobs(): string[] {
  const globs = new Set<string>();
  for (const name of EXACT_FILENAMES) globs.add(`**/${name}`);
  for (const ext of EXCLUDED_EXTENSIONS) globs.add(`**/*${ext}`);
  for (const segment of EXCLUDED_PATH_SEGMENTS) globs.add(`**/${segment}**`);
  return [...globs];
}
