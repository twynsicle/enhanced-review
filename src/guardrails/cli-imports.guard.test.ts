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
 * Guardrail — the local CLI (`src/cli`) runs on an
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

/**
 * The Agent SDK is the one package the CLI does need, and the one it must not
 * load to start: importing it spawns nothing by itself but pulls in tens of
 * megabytes, and `er` has to run `--stub`, `--from parse` and every test
 * without it. `claude-run.ts` therefore reaches it through `await import(...)`
 * inside the run stage, and everything else takes types only. A plain
 * `import { query } from …` slipped in anywhere in the graph undoes that and
 * nothing would ever say so.
 */
const AGENT_SDK = '@anthropic-ai/claude-agent-sdk';

function resolveFile(target: string): string | null {
  for (const candidate of [`${target}.ts`, `${target}.tsx`, `${target}/index.ts`]) {
    if (existsSync(path.join(REPO_ROOT, candidate))) return candidate;
  }
  return null;
}

/**
 * Every file the CLI can reach, each mapped to the file that first imported
 * it so a violation can be reported as a chain rather than a name.
 */
function cliGraph(): Map<string, string | null> {
  const entries = listFiles(['src/cli/**/*.ts']).filter((f) => !isTestFile(f));
  const via = new Map<string, string | null>(entries.map((f) => [f, null]));
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of importSpecifiers(readSource(file))) {
      const target = resolveProjectImport(spec, file);
      if (!target) continue;
      const resolved = resolveFile(target);
      if (resolved && !via.has(resolved)) {
        via.set(resolved, file);
        queue.push(resolved);
      }
    }
  }
  return via;
}

function chainIn(via: Map<string, string | null>, file: string): string {
  const parts = [file];
  let parent = via.get(file);
  while (parent) {
    parts.unshift(parent);
    parent = via.get(parent);
  }
  return parts.join(' → ');
}

/**
 * Every statement that loads a module at import time, with whether it is
 * type-only. `export { query } from …` loads the module exactly as an import
 * of it does, so both shapes count. A dynamic `import(…)` has no space before
 * its bracket and so never matches, which is the point: those are the ones
 * that cost nothing until they run.
 */
function staticLoads(source: string): { spec: string; typeOnly: boolean }[] {
  const pattern = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].map((match) => ({
    spec: match[2]!,
    typeOnly: match[1] !== undefined,
  }));
}

describe('guardrail: cli imports', () => {
  it('nothing the CLI loads reaches env.ts, the logger, the db or a server package', () => {
    const violations: string[] = [];
    const via = cliGraph();
    for (const file of via.keys()) {
      for (const spec of importSpecifiers(readSource(file))) {
        const target = resolveProjectImport(spec, file);
        if (!target) {
          if (FORBIDDEN_PACKAGES.test(spec))
            violations.push(`${chainIn(via, file)} imports ${spec}`);
          continue;
        }
        const reason =
          FORBIDDEN_MODULES[target] ??
          Object.entries(FORBIDDEN_PREFIXES).find(([prefix]) => target.startsWith(prefix))?.[1];
        if (reason) violations.push(`${chainIn(via, file)} → ${target} (${reason})`);
      }
    }
    expect(report(violations)).toBe('');
  });

  it('reaches the Agent SDK only through a type-only or a dynamic import', () => {
    const violations: string[] = [];
    const via = cliGraph();
    for (const file of via.keys()) {
      for (const { spec, typeOnly } of staticLoads(readSource(file))) {
        if (spec !== AGENT_SDK && !spec.startsWith(`${AGENT_SDK}/`)) continue;
        if (typeOnly) continue;
        violations.push(`${chainIn(via, file)} loads ${spec} at import time`);
      }
    }
    expect(report(violations)).toBe('');
  });

  it('counts a re-export as a load and a dynamic import as none', () => {
    expect(staticLoads(`export { query } from '${AGENT_SDK}';`)).toEqual([
      { spec: AGENT_SDK, typeOnly: false },
    ]);
    expect(staticLoads(`export * from '${AGENT_SDK}';`)).toEqual([
      { spec: AGENT_SDK, typeOnly: false },
    ]);
    expect(staticLoads(`export type { Query } from '${AGENT_SDK}';`)).toEqual([
      { spec: AGENT_SDK, typeOnly: true },
    ]);
    expect(staticLoads(`import { query } from '${AGENT_SDK}';`)).toEqual([
      { spec: AGENT_SDK, typeOnly: false },
    ]);
    expect(staticLoads(`const { query } = await import('${AGENT_SDK}');`)).toEqual([]);
  });
});
