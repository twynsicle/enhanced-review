import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  importSpecifiers,
  isTestFile,
  listFiles,
  readSource,
  report,
  resolveProjectImport,
} from './helpers';

/**
 * Guardrail — the local CLI (`src/cli`, docs/local-mode A4) runs on an
 * engineer's laptop with none of the server's configuration. Anything it
 * loads that reaches `src/config/env.ts` throws at import (the server's
 * required secrets are missing), the logger imports env, and the database
 * layer has nothing to talk to. So the CLI's whole import graph, followed
 * through every shared module it touches, must stay clear of all three, and
 * of the server-only packages it has no use for.
 *
 * Type-only imports are followed too: stricter than the runtime needs, but it
 * keeps the rule a plain graph walk.
 */
const FORBIDDEN_MODULES: Record<string, string> = {
  'src/config/env': 'env.ts requires the server secrets at import',
  'src/common/logger': 'the logger imports env.ts',
};
const FORBIDDEN_PREFIXES: Record<string, string> = {
  'src/db/': 'the database layer is server-only',
};
const FORBIDDEN_PACKAGES = /^(@prisma\/|pg$|pino|@octokit\/)/;

function resolveFile(target: string): string | null {
  for (const candidate of [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
    if (existsSync(path.join(REPO_ROOT, candidate))) return candidate;
  }
  return null;
}

describe('guardrail: cli imports', () => {
  it('nothing the CLI loads reaches env.ts, the logger, the db or a server package', () => {
    const entries = listFiles(['src/cli/**/*.ts']).filter((f) => !isTestFile(f));
    const violations: string[] = [];
    // file → the file that first imported it, for a readable chain.
    const via = new Map<string, string | null>(entries.map((f) => [f, null]));
    const queue = [...entries];
    const chain = (file: string): string => {
      const parts = [file];
      let parent = via.get(file);
      while (parent) {
        parts.unshift(parent);
        parent = via.get(parent);
      }
      return parts.join(' → ');
    };

    while (queue.length > 0) {
      const file = queue.shift()!;
      for (const spec of importSpecifiers(readSource(file))) {
        const target = resolveProjectImport(spec, file);
        if (!target) {
          if (FORBIDDEN_PACKAGES.test(spec)) violations.push(`${chain(file)} imports ${spec}`);
          continue;
        }
        const reason =
          FORBIDDEN_MODULES[target] ??
          Object.entries(FORBIDDEN_PREFIXES).find(([prefix]) => target.startsWith(prefix))?.[1];
        if (reason) {
          violations.push(`${chain(file)} → ${target} (${reason})`);
          continue;
        }
        const resolved = resolveFile(target);
        if (resolved && !via.has(resolved)) {
          via.set(resolved, file);
          queue.push(resolved);
        }
      }
    }
    expect(report(violations)).toBe('');
  });
});
