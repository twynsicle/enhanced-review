import { describe, expect, it } from 'vitest';
import { isTestFile, listFiles, readSource, report } from './helpers.ts';

/**
 * Guardrail — `er` reaches the Agent SDK only when a run needs it. Importing
 * the SDK spawns nothing by itself but pulls in tens of megabytes, and `er`
 * has to run `--stub`, `--from parse` and every test without it.
 * `claude-run.ts` therefore reaches it through `await import(...)` inside the
 * run stage, and everything else takes types only. A plain
 * `import { query } from …` slipped in anywhere undoes that and nothing would
 * ever say so. Only `src/cli` is scanned: layering keeps the SDK out of
 * `review` and `report` altogether.
 */
const AGENT_SDK = '@anthropic-ai/claude-agent-sdk';

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

describe('guardrail: the Agent SDK loads lazily', () => {
  it('reaches the Agent SDK only through a type-only or a dynamic import', () => {
    const violations: string[] = [];
    for (const file of listFiles(['src/cli/**/*.ts']).filter((f) => !isTestFile(f))) {
      for (const { spec, typeOnly } of staticLoads(readSource(file))) {
        if (spec !== AGENT_SDK && !spec.startsWith(`${AGENT_SDK}/`)) continue;
        if (!typeOnly) violations.push(`${file} loads ${spec} at import time`);
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
