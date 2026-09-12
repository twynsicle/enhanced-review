import { describe, expect, it } from 'vitest';
import { listFiles, readSource, report } from './helpers';

/**
 * Guardrail — all output goes through the pino logger
 * (`src/common/logger.ts`); `console.*` is never used directly.
 */
describe('guardrail: no console', () => {
  it('console.* appears only in src/common/logger.ts', () => {
    const files = listFiles(['src/**/*.{ts,tsx}', 'server/**/*.ts'], ['src/common/logger.ts']);
    const violations = files.filter((file) => /\bconsole\.[a-z]+\(/.test(readSource(file)));
    expect(report(violations)).toBe('');
  });
});
