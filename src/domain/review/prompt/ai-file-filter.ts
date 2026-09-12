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

/**
 * The built-in list as a skip reason, or null when the path is none of it.
 * These are the marks a repository does not have to make for itself; what it
 * does mark is read from its `.gitattributes` in `skipReasons`.
 */
export function builtInSkipReason(filename: string): ReviewFileSkipReason | null {
  const lower = filename.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;

  if (EXACT_FILENAMES.has(basename)) return 'built-in';
  if (EXCLUDED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'built-in';
  if (EXCLUDED_PATH_SEGMENTS.some((segment) => lower.includes(segment))) return 'built-in';
  return null;
}

/** Binary as a skip reason: git has no text hunks to put in front of the model. */
export function binarySkipReason(binary: boolean): ReviewFileSkipReason | null {
  return binary ? 'binary' : null;
}
