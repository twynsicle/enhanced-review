import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Shared plumbing for the repo-reading guardrail tests. Everything works on
 * repo-relative POSIX paths (`src/web/root.tsx`) so assertions read the same
 * on Windows and Linux.
 */
// Vitest runs from the repo root; `import.meta.url` is not a file: URL under
// happy-dom, so the cwd is the reliable anchor.
export const REPO_ROOT = process.cwd();

// Guardrail sources mention the very patterns they police, so they are never
// subjects themselves.
const ALWAYS_EXCLUDE = [
  'node_modules/**',
  'build/**',
  'legacy/**',
  '.react-router/**',
  'src/guardrails/**',
];

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Repo-relative POSIX paths matching the patterns (minus build/legacy noise). */
export function listFiles(patterns: string[], exclude: string[] = []): string[] {
  const excluded = [...ALWAYS_EXCLUDE, ...exclude];
  return globSync(patterns, { cwd: REPO_ROOT })
    .map(toPosix)
    .filter((rel) => !excluded.some((pattern) => matchesGlob(rel, pattern)))
    .toSorted();
}

export function readSource(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

export function isTestFile(relPath: string): boolean {
  return /\.(test|spec|integration\.test)\.[cm]?[jt]sx?$/.test(relPath);
}

/** Static + dynamic import specifiers, plus `export ... from` re-exports. */
export function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'"]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]!);
  }
  return specs;
}

/**
 * Resolve an `@/` or relative specifier to a repo-relative path without the
 * extension (e.g. `src/web/theme/theme`). Bare package specifiers → null.
 */
export function resolveProjectImport(spec: string, fromFile: string): string | null {
  let target: string;
  if (spec.startsWith('@/')) {
    target = `src/${spec.slice(2)}`;
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    target = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec)));
  } else {
    return null;
  }
  return target.replace(/\.[cm]?[jt]sx?$/, '');
}

export type Area = 'web' | 'domain' | 'db' | 'jobs' | 'common' | 'config' | 'guardrails' | 'test';

export function areaOf(relPath: string): Area | null {
  const match = /^src\/([^/]+)\//.exec(relPath);
  if (!match) return null;
  const area = match[1]!;
  if (
    area === 'web' ||
    area === 'domain' ||
    area === 'db' ||
    area === 'jobs' ||
    area === 'common' ||
    area === 'config' ||
    area === 'guardrails' ||
    area === 'test'
  ) {
    return area;
  }
  return null;
}

/** Minimal glob matcher: `**`, `*`, and literal segments. */
export function matchesGlob(relPath: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(relPath);
}

/** Formats violations so the failing assertion names every offender. */
export function report(violations: string[]): string {
  return violations.length === 0 ? '' : `\n${violations.map((v) => `  - ${v}`).join('\n')}\n`;
}
