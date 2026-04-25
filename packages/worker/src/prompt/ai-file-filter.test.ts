import { describe, expect, it } from 'vitest';

import { builtInDenyGlobs, isExcludedFromAI } from './ai-file-filter';

describe('isExcludedFromAI', () => {
  it('excludes exact lock file names', () => {
    expect(isExcludedFromAI('package-lock.json')).toBe(true);
    expect(isExcludedFromAI('yarn.lock')).toBe(true);
    expect(isExcludedFromAI('pnpm-lock.yaml')).toBe(true);
    expect(isExcludedFromAI('cargo.lock')).toBe(true);
    expect(isExcludedFromAI('go.sum')).toBe(true);
    expect(isExcludedFromAI('bun.lockb')).toBe(true);
  });

  it('excludes binary/build artefacts by extension', () => {
    expect(isExcludedFromAI('Component.test.snap')).toBe(true);
    expect(isExcludedFromAI('bundle.min.js')).toBe(true);
    expect(isExcludedFromAI('styles.min.css')).toBe(true);
    expect(isExcludedFromAI('bundle.js.map')).toBe(true);
    expect(isExcludedFromAI('something.lock')).toBe(true);
  });

  it('excludes __snapshots__/ path segment', () => {
    expect(isExcludedFromAI('src/__snapshots__/test.snap')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(isExcludedFromAI('Package-Lock.JSON')).toBe(true);
    expect(isExcludedFromAI('BUNDLE.MIN.JS')).toBe(true);
    expect(isExcludedFromAI('src/__SNAPSHOTS__/test.snap')).toBe(true);
  });

  it('matches exact filenames at any path depth', () => {
    expect(isExcludedFromAI('path/to/package-lock.json')).toBe(true);
    expect(isExcludedFromAI('deep/nested/yarn.lock')).toBe(true);
  });

  it('does not exclude normal source files', () => {
    expect(isExcludedFromAI('src/main.ts')).toBe(false);
    expect(isExcludedFromAI('App.tsx')).toBe(false);
    expect(isExcludedFromAI('styles.css')).toBe(false);
    expect(isExcludedFromAI('README.md')).toBe(false);
  });

  it('honours user-supplied patterns by basename, suffix, and substring', () => {
    expect(isExcludedFromAI('generated.ts', ['generated.ts'])).toBe(true);
    expect(isExcludedFromAI('data.csv', ['.csv'])).toBe(true);
    expect(isExcludedFromAI('src/vendor/lib.js', ['vendor/'])).toBe(true);
  });

  it('does not exclude when user patterns do not match', () => {
    expect(isExcludedFromAI('src/main.ts', ['vendor/', '.csv'])).toBe(false);
  });

  it('returns false for empty filename and empty pattern lists', () => {
    expect(isExcludedFromAI('')).toBe(false);
    expect(isExcludedFromAI('src/main.ts', [])).toBe(false);
  });
});

describe('builtInDenyGlobs', () => {
  it('emits glob patterns rooted at any depth', () => {
    const globs = builtInDenyGlobs();
    expect(globs).toContain('**/package-lock.json');
    expect(globs).toContain('**/*.snap');
    expect(globs).toContain('**/__snapshots__/**');
  });

  it('produces unique entries', () => {
    const globs = builtInDenyGlobs();
    expect(new Set(globs).size).toBe(globs.length);
  });
});
