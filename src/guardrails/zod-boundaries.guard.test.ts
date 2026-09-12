import { describe, expect, it } from 'vitest';
import { importSpecifiers, isTestFile, listFiles, readSource, report } from './helpers';

/**
 * Guardrail — every loader/action that reads request input (route
 * params, search params, form data, JSON body) validates it with Zod, either
 * directly or through the `@/web/lib/parse.server` helpers.
 */
const READS_INPUT = /\bparams\b|request\.url\b|\.formData\(\)|\.json\(\)|searchParams/;
const HAS_HANDLER =
  /\bexport\s+(?:async\s+)?(?:function|const)\s+(loader|action|clientLoader|clientAction)\b/;
const VALIDATES = (spec: string) => spec === 'zod' || spec === '@/web/lib/parse.server';

describe('guardrail: zod at route boundaries', () => {
  it('loaders and actions that read input import zod or the parse helpers', () => {
    const violations: string[] = [];
    for (const file of listFiles(['src/web/routes/**/*.{ts,tsx}']).filter((f) => !isTestFile(f))) {
      const source = readSource(file);
      if (!HAS_HANDLER.test(source) || !READS_INPUT.test(source)) continue;
      if (!importSpecifiers(source).some(VALIDATES)) {
        violations.push(`${file} reads request input without zod / parse.server`);
      }
    }
    expect(report(violations)).toBe('');
  });
});
