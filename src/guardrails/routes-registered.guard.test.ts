import { describe, expect, it } from 'vitest';
import { isTestFile, listFiles, readSource, report } from './helpers';

/**
 * Guardrail A4(d) — `src/web/routes.ts` is the single route table. Every
 * module under `src/web/routes/` is referenced from it, and every reference
 * points at a file that exists. Keeps dead route modules and typos out.
 */
describe('guardrail: routes registered', () => {
  const routeFiles = listFiles(['src/web/routes/**/*.{ts,tsx}']).filter((f) => !isTestFile(f));
  const table = readSource('src/web/routes.ts');
  const referenced = [...table.matchAll(/['"](routes\/[^'"]+)['"]/g)].map((m) => `src/web/${m[1]}`);

  it('every file under src/web/routes/ is listed in routes.ts', () => {
    const missing = routeFiles.filter((f) => !referenced.includes(f));
    expect(report(missing)).toBe('');
  });

  it('every routes.ts entry points at an existing file', () => {
    const dangling = referenced.filter((f) => !routeFiles.includes(f));
    expect(report(dangling)).toBe('');
  });
});
