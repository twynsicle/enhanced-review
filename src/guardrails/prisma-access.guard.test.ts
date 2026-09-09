import { describe, expect, it } from 'vitest';
import { importSpecifiers, listFiles, readSource, report, resolveProjectImport } from './helpers';

/**
 * Guardrail — Prisma stays behind `src/db/`. The generated client,
 * `@prisma/client` and the driver adapter are imported only from `src/db/**`;
 * every other area talks to the repository modules there.
 */
const PRISMA_PACKAGES = /^@prisma\//;

describe('guardrail: prisma access', () => {
  it('generated client and @prisma/* are imported only under src/db/', () => {
    const violations: string[] = [];
    for (const file of listFiles(['src/**/*.{ts,tsx}', 'server/**/*.ts'], ['src/db/**'])) {
      for (const spec of importSpecifiers(readSource(file))) {
        const target = resolveProjectImport(spec, file);
        if (PRISMA_PACKAGES.test(spec) || target?.startsWith('src/db/generated/')) {
          violations.push(`${file} imports ${spec}`);
        }
      }
    }
    expect(report(violations)).toBe('');
  });
});
