import { globSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERATED_OUTPUT, REPO_ROOT, listFiles, readSource, report, toPosix } from './helpers';

/**
 * Guardrail — a repo path named in a comment still points at something. A
 * rename breaks every pointer at it without breaking anything a compiler or a
 * linter sees, and the rot stays invisible until a reader follows one, finds
 * nothing, and stops trusting the next comment too.
 *
 * The scope is deliberately narrow, because a guardrail that cries wolf gets
 * deleted rather than obeyed. A claim counts only when its first segment is a
 * real top-level entry here — that is what separates a path into this tree
 * from a path into another, the review workspace's `context/pr.md` or a git
 * `refs/tags/` namespace — so an unbackticked path, an `@/` alias and a
 * shorthand relative to an area root go unchecked entirely. Tests are
 * scanned, unlike in the guardrails next door: their comments rot like any
 * other. Every filter here skips rather than fails, so a renamed top-level
 * entry would quietly disable the check beneath it; the floor below is the
 * proportionate answer to that, not a cure. The alternative to all of it is
 * guessing, and a guardrail that guesses is one that gets switched off.
 */
const SOURCES = ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'prisma/**/*.prisma', '*.ts'];

const COMMENT_LINE = /^\s*\{?(?:\/\/|\/\*|\*)/;
const BACKTICKED = /`([^`\n]+)`/g;
const PLAIN_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/;
const REPO_EXTENSION =
  /\.(?:tsx?|jsx?|[cm]js|[cm]ts|css|scss|json|ya?ml|mdx?|sh|sql|html|svg|png|ico|txt|toml|prisma|example)$/;

const GENERATED_ROOTS = GENERATED_OUTPUT.map((pattern) => pattern.replace(/\/\*\*$/, ''));

/** Generated output is absent on a clean checkout, so its absence proves nothing. */
function isGenerated(claim: string): boolean {
  return GENERATED_ROOTS.some((root) => claim === root || claim.startsWith(`${root}/`));
}

const TOP_LEVEL = readdirSync(REPO_ROOT);

/**
 * Claims resolve against this rather than the filesystem, so a miscased path
 * fails here instead of only on the Linux runner. Entries come from directory
 * reads, which give the case the disk actually stores; `**` skips dotted
 * names, hence globbing each top-level entry by name. Directories are listed
 * alongside files, so a claim ending in `/` needs no second index.
 */
const INVENTORY = new Set([
  ...TOP_LEVEL,
  ...globSync(
    TOP_LEVEL.filter((entry) => entry !== '.git' && !isGenerated(entry)).map(
      (entry) => `${entry}/**/*`,
    ),
    { cwd: REPO_ROOT, exclude: GENERATED_OUTPUT },
  ).map(toPosix),
]);

/** The path a backticked token is claiming to be, or null if it claims none. */
function pathClaim(token: string): string | null {
  const claim = token
    .trim()
    .replace(/[.,;)\]]+$/, '')
    .replace(/:\d+(?:[-:]\d+)?$/, '');
  if (!PLAIN_PATH.test(claim) || !claim.includes('/')) return null;
  if (!claim.endsWith('/') && !REPO_EXTENSION.test(claim)) return null;
  const root = claim.slice(0, claim.indexOf('/'));
  if (!TOP_LEVEL.includes(root) || isGenerated(claim)) return null;
  return claim;
}

type Claim = { file: string; line: number; claim: string };

const CLAIMS: Claim[] = listFiles(SOURCES).flatMap((file) =>
  readSource(file)
    .split('\n')
    .flatMap((line, index) => {
      if (!COMMENT_LINE.test(line)) return [];
      return [...line.matchAll(BACKTICKED)]
        .map((match) => pathClaim(match[1]!))
        .filter((claim) => claim !== null)
        .map((claim) => ({ file, line: index + 1, claim }));
    }),
);

// Well under the claims the tree carries today, so it fires on collapse and
// not on a handful of pointers being deleted.
const MIN_CLAIMS = 10;

describe('guardrail: comment paths', () => {
  it('every repo path named in a comment exists', () => {
    const violations = CLAIMS.filter(({ claim }) => !INVENTORY.has(claim.replace(/\/$/, ''))).map(
      ({ file, line, claim }) =>
        `${file}:${line} points at \`${claim}\`, which does not exist — ` +
        `name where that code lives now, or drop the pointer`,
    );
    expect(report(violations)).toBe('');
  });

  it('still finds paths to check', () => {
    const starved =
      CLAIMS.length >= MIN_CLAIMS
        ? ''
        : `only ${CLAIMS.length} comment paths were found, below the floor of ${MIN_CLAIMS} — ` +
          `every filter above skips rather than fails, so a renamed top-level entry or a stale ` +
          `SOURCES glob leaves the check green while it inspects nothing`;
    expect(starved).toBe('');
  });
});
