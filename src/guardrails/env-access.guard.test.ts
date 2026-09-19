import { describe, expect, it } from 'vitest';
import { listFiles, readSource, report } from './helpers.ts';

/**
 * Guardrail — `process.env` is read only in `src/cli/host-env.ts`, so what
 * `er` takes from the engineer's environment, and hands on to git, gh and the
 * Agent SDK, is decided in one place.
 */
describe('guardrail: env access', () => {
  it('process.env appears only in src/cli/host-env.ts', () => {
    const files = listFiles(['src/**/*.{ts,tsx}'], ['src/cli/host-env.ts']);
    const violations = files.filter((file) => /\bprocess\.env\b/.test(readSource(file)));
    expect(report(violations)).toBe('');
  });
});
