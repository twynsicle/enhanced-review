import { describe, expect, it } from 'vitest';
import { listFiles, readSource, report } from './helpers';

/**
 * Guardrail — `process.env` is read only in `src/config/`, so every
 * environment variable is declared, validated and defaulted in one place.
 */
describe('guardrail: env access', () => {
  it('process.env appears only under src/config/', () => {
    const files = listFiles(['src/**/*.{ts,tsx}', 'server/**/*.ts'], ['src/config/**']);
    const violations = files.filter((file) => /\bprocess\.env\b/.test(readSource(file)));
    expect(report(violations)).toBe('');
  });
});
