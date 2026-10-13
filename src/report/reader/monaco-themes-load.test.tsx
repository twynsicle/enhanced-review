import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/review/bundle';
import type { DiffChunk } from '@/review/narrative';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { render, screen } from '@/report/test/render';
import { InlineDiffChunk } from './inline-diff-chunk';
import { DIMMED_THEME } from './monaco-themes';

/**
 * The editor load is cached for the life of the module, so only the first
 * mount in a module can show whether the themes were registered before it.
 * Hence a file of its own, holding that one mount.
 */
const defineTheme = vi.hoisted(() => vi.fn());
const definedAtMount = vi.hoisted((): string[][] => []);

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => {
    definedAtMount.push(defineTheme.mock.calls.map(([name]) => name as string));
    return <div data-testid="diff-editor" />;
  },
  loader: { config: () => {}, init: () => Promise.resolve({ editor: { defineTheme } }) },
}));

const chunk: DiffChunk = {
  filename: 'src/main.ts',
  language: 'typescript',
  hunks: [
    {
      id: 'H0001',
      fileOrder: 1,
      original: { startLine: 1, lineCount: 1 },
      modified: { startLine: 1, lineCount: 1 },
      tier: 'read',
    },
  ],
};

const bundle: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T10:00:00.000Z',
  meta: {
    repo: 'a/r',
    kind: 'branch',
    title: 't',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    prNumber: null,
    baseRefName: null,
    headRefName: null,
    authorLogin: null,
    description: null,
    stats: null,
  },
  review: { prTitle: 't', overviewSummary: { lede: '' }, chapters: [] },
  files: {
    'src/main.ts': {
      base: { kind: 'content', content: '// a\n' },
      head: { kind: 'content', content: '// b\n' },
    },
  },
};

describe('loading the code viewer', () => {
  beforeEach(() => {
    defineTheme.mockClear();
    definedAtMount.length = 0;
  });

  it('registers both dimmed themes before the first editor mounts', async () => {
    render(
      <EmbeddedFileSource bundle={bundle}>
        <InlineDiffChunk chunk={chunk} />
      </EmbeddedFileSource>,
    );
    await screen.findByTestId('diff-editor');

    expect(definedAtMount[0]).toEqual(
      expect.arrayContaining([DIMMED_THEME.light, DIMMED_THEME.dark]),
    );
  });
});
