import { describe, expect, it } from 'vitest';
import { builtInDenyGlobs, isExcludedFromAI } from './ai-file-filter.ts';

describe('isExcludedFromAI', () => {
  it('excludes lockfiles by basename, case-insensitively', () => {
    expect(isExcludedFromAI('package-lock.json')).toBe(true);
    expect(isExcludedFromAI('apps/web/Gemfile.lock')).toBe(true);
    expect(isExcludedFromAI('go.sum')).toBe(true);
  });

  it('excludes generated artefacts by extension and snapshot directories', () => {
    expect(isExcludedFromAI('dist/app.min.js')).toBe(true);
    expect(isExcludedFromAI('dist/app.js.map')).toBe(true);
    expect(isExcludedFromAI('src/__snapshots__/x.test.ts.snap')).toBe(true);
  });

  it('keeps ordinary source files', () => {
    expect(isExcludedFromAI('src/index.ts')).toBe(false);
    expect(isExcludedFromAI('package.json')).toBe(false);
    expect(isExcludedFromAI('docs/locking.md')).toBe(false);
  });

  it('honours user patterns as basename, suffix or substring matches', () => {
    expect(isExcludedFromAI('src/generated/schema.ts', ['generated/'])).toBe(true);
    expect(isExcludedFromAI('src/schema.ts', ['schema.ts'])).toBe(true);
    expect(isExcludedFromAI('src/schema.ts', ['other'])).toBe(false);
  });
});

describe('builtInDenyGlobs', () => {
  it('mirrors the exclusion rules as globs', () => {
    const globs = builtInDenyGlobs();
    expect(globs).toContain('**/package-lock.json');
    expect(globs).toContain('**/*.min.js');
    expect(globs).toContain('**/__snapshots__/**');
    expect(new Set(globs).size).toBe(globs.length);
  });
});
