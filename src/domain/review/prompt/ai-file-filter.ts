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

/**
 * Why the prompt leaves a changed file out, from the file alone, or null when
 * it reaches the model. The reader needs this recorded on the file: without
 * it a filtered file looks like one the model simply chose not to discuss,
 * and the file view claims it changed without a text diff.
 *
 * The local CLI layers the repository's own `.gitattributes` between these
 * two — `generated` and `vendored` need a `git check-attr` at the head, which
 * the hosted path does not run.
 */
export function promptSkipReason(
  file: { filename: string; binary: boolean },
  userPatterns?: readonly string[],
): ReviewFileSkipReason | null {
  if (isExcludedFromAI(file.filename, userPatterns)) return 'built-in';
  return file.binary ? 'binary' : null;
}

/** The same rules as globs, for tools that take deny patterns. */
export function builtInDenyGlobs(): string[] {
  const globs = new Set<string>();
  for (const name of EXACT_FILENAMES) globs.add(`**/${name}`);
  for (const ext of EXCLUDED_EXTENSIONS) globs.add(`**/*${ext}`);
  for (const segment of EXCLUDED_PATH_SEGMENTS) globs.add(`**/${segment}**`);
  return [...globs];
}
