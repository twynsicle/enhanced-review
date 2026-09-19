import { describe, expect, it } from 'vitest';
import {
  type Area,
  areaOf,
  importSpecifiers,
  isTestFile,
  listFiles,
  readSource,
  report,
  resolveProjectImport,
} from './helpers.ts';

/**
 * Guardrail — layering.
 *
 *   cli    → cli, review
 *   report → report, review
 *   review → review
 *
 * `review` is the shape of a review and the rules that judge one, read by the
 * CLI in Node and by the report in the browser, so it may import neither side
 * and nothing that only one side can load: no Node builtin, no Agent SDK, no
 * UI package. The report ships to the browser as one file, so it may not
 * import Node or the SDK either. Only the report renders, so only the report
 * imports React, Mantine or the icons.
 */
const ALLOWED: Record<'cli' | 'report' | 'review', Area[]> = {
  cli: ['cli', 'review'],
  report: ['report', 'review'],
  review: ['review'],
};

const UI_PACKAGES = /^(react|react-dom|@mantine\/|@tabler\/|@monaco-editor\/|zustand)/;
const NODE_ONLY = /^(node:|@anthropic-ai\/claude-agent-sdk)/;

describe('guardrail: layering', () => {
  const files = listFiles(['src/**/*.{ts,tsx}']).filter((f) => !isTestFile(f));

  it('areas only import from the layers they are allowed', () => {
    const violations: string[] = [];
    for (const file of files) {
      const area = areaOf(file);
      if (area !== 'cli' && area !== 'report' && area !== 'review') continue;
      for (const spec of importSpecifiers(readSource(file))) {
        const target = resolveProjectImport(spec, file);
        if (!target) continue;
        const targetArea = areaOf(`${target}/`) ?? areaOf(target);
        if (targetArea && !ALLOWED[area].includes(targetArea)) {
          violations.push(`${file} imports ${spec} (${area} → ${targetArea} is not allowed)`);
        }
      }
    }
    expect(report(violations)).toBe('');
  });

  it('review and report load nothing that needs Node', () => {
    const violations: string[] = [];
    for (const file of files) {
      const area = areaOf(file);
      if (area !== 'review' && area !== 'report') continue;
      for (const spec of importSpecifiers(readSource(file))) {
        if (NODE_ONLY.test(spec)) violations.push(`${file} imports ${spec}`);
      }
    }
    expect(report(violations)).toBe('');
  });

  it('only src/report imports React or a UI package', () => {
    const violations: string[] = [];
    for (const file of files) {
      if (areaOf(file) === 'report') continue;
      for (const spec of importSpecifiers(readSource(file))) {
        if (UI_PACKAGES.test(spec)) violations.push(`${file} imports ${spec}`);
      }
    }
    expect(report(violations)).toBe('');
  });
});
