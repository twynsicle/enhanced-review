import { describe, expect, it } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, filePair, parseBundle, type ReviewBundle } from './bundle.ts';

const bundle: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T10:00:00.000Z',
  meta: {
    repo: 'acme/widgets',
    title: 'Scheduled reviews',
    prNumber: null,
    baseRefName: 'main',
    headRefName: 'feat/scheduler',
    authorLogin: null,
    description: null,
    stats: null,
  },
  review: {
    prTitle: 'Scheduled reviews',
    overviewSummary: { lede: 'Adds a scheduler.' },
    chapters: [],
  },
  files: {
    'src/changed.ts': {
      base: { kind: 'content', content: 'one\n' },
      head: { kind: 'content', content: 'one\ntwo\n' },
    },
    'src/added.ts': { base: { kind: 'absent' }, head: { kind: 'content', content: 'new' } },
    'dist/huge.js': { base: { kind: 'too-large' }, head: { kind: 'too-large' } },
  },
};

describe('parseBundle', () => {
  it('accepts a bundle of the current version', () => {
    const result = parseBundle(JSON.parse(JSON.stringify(bundle)));
    expect(result).toEqual({ ok: true, bundle });
  });

  it('reports a different version before looking at the shape', () => {
    expect(parseBundle({ schemaVersion: 99, anything: true })).toEqual({
      ok: false,
      reason: 'version-mismatch',
      found: 99,
    });
    expect(parseBundle('not a bundle')).toMatchObject({ reason: 'version-mismatch' });
  });

  it('rejects a current-version bundle with the wrong shape', () => {
    expect(parseBundle({ ...bundle, review: { chapters: 'no' } })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('filePair', () => {
  it('returns both sides with a detected language and line counts', () => {
    const pair = filePair(bundle, 'src/changed.ts');
    expect(pair.base).toEqual({
      ok: true,
      data: { content: 'one\n', language: 'typescript', lineCount: 2 },
    });
    expect(pair.head).toMatchObject({ ok: true, data: { lineCount: 3 } });
  });

  it('reads an absent side as not-found, which the reader shows as an added file', () => {
    expect(filePair(bundle, 'src/added.ts').base).toEqual({
      ok: false,
      error: { kind: 'not-found' },
    });
  });

  it('passes too-large through', () => {
    expect(filePair(bundle, 'dist/huge.js').head).toEqual({
      ok: false,
      error: { kind: 'too-large' },
    });
  });

  it('reads a path the bundle does not hold as missing on both sides', () => {
    const pair = filePair(bundle, 'nowhere.ts');
    expect(pair.base).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect(pair.head).toEqual({ ok: false, error: { kind: 'not-found' } });
  });
});
