import { describe, expect, it } from 'vitest';
import { binarySkipReason, builtInSkipReason } from './ai-file-filter.ts';

describe('builtInSkipReason', () => {
  it('excludes lockfiles by basename, case-insensitively', () => {
    expect(builtInSkipReason('package-lock.json')).toBe('built-in');
    expect(builtInSkipReason('apps/web/Gemfile.lock')).toBe('built-in');
    expect(builtInSkipReason('go.sum')).toBe('built-in');
  });

  it('excludes generated artefacts by extension and snapshot directories', () => {
    expect(builtInSkipReason('dist/app.min.js')).toBe('built-in');
    expect(builtInSkipReason('dist/app.js.map')).toBe('built-in');
    expect(builtInSkipReason('src/__snapshots__/x.test.ts.snap')).toBe('built-in');
  });

  it('keeps ordinary source files', () => {
    expect(builtInSkipReason('src/index.ts')).toBeNull();
    expect(builtInSkipReason('package.json')).toBeNull();
    expect(builtInSkipReason('docs/locking.md')).toBeNull();
  });
});

describe('binarySkipReason', () => {
  it('is a reason only for a file git has no text to diff for', () => {
    expect(binarySkipReason(true)).toBe('binary');
    expect(binarySkipReason(false)).toBeNull();
  });
});
