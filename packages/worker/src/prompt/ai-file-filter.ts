/**
 * Filename patterns excluded from AI processing. Ported verbatim from the
 * diffy POC at `diffy/src/shared/ai-file-filter.ts`. The worker uses this
 * for two purposes:
 *   - strip the matching diff patches from the prompt sent to opencode
 *   - drive the `permission.read.deny` rules in the generated opencode.json
 *     so the agent can't accidentally read the same files via filesystem
 *     tools either.
 *
 * Matched against the full file path (case-insensitive).
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

const EXCLUDED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.snap',
  '.min.js',
  '.min.css',
  '.map',
  '.lock',
]);

const EXCLUDED_PATH_SEGMENTS: readonly string[] = ['__snapshots__/'];

export function isExcludedFromAI(filename: string, userPatterns?: readonly string[]): boolean {
  const lower = filename.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;

  if (EXACT_FILENAMES.has(basename)) return true;

  for (const ext of EXCLUDED_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }

  for (const segment of EXCLUDED_PATH_SEGMENTS) {
    if (lower.includes(segment)) return true;
  }

  if (userPatterns) {
    for (const pattern of userPatterns) {
      const p = pattern.toLowerCase();
      if (basename === p || lower.endsWith(p) || lower.includes(p)) return true;
    }
  }

  return false;
}

/**
 * Glob patterns suitable for the `permission.read.deny` rules in opencode's
 * config. Rooted to **\/<basename> so the rule matches at any depth.
 */
export function builtInDenyGlobs(): string[] {
  const globs = new Set<string>();
  for (const name of EXACT_FILENAMES) globs.add(`**/${name}`);
  for (const ext of EXCLUDED_EXTENSIONS) globs.add(`**/*${ext}`);
  for (const segment of EXCLUDED_PATH_SEGMENTS) globs.add(`**/${segment}**`);
  return [...globs];
}
