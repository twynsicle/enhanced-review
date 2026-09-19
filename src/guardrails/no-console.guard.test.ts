import { describe, expect, it } from 'vitest';
import { listFiles, readSource, report } from './helpers.ts';

/**
 * Guardrail — `console.*` is never used. Everything `er` prints goes through
 * `src/cli/terminal.ts`, which knows stdout from stderr and when to colour;
 * the report has nobody reading its console.
 */
describe('guardrail: no console', () => {
  it('console.* appears nowhere', () => {
    const files = listFiles(['src/**/*.{ts,tsx}']);
    const violations = files.filter((file) => /\bconsole\.[a-z]+\(/.test(readSource(file)));
    expect(report(violations)).toBe('');
  });
});
