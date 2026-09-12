import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import type { DiffChunk } from '@/domain/review/narrative';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { useDiffView } from '@/web/stores/diff-view';
import { render, screen, waitFor } from '@/web/test/render';
import { InlineDiffChunk } from './inline-diff-chunk';

/** The options the last mounted editor was constructed with. */
const lastOptions = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ options }: { options: Record<string, unknown> }) => {
    lastOptions.current = options;
    return <div data-testid="diff-editor" />;
  },
}));

const chunk: DiffChunk = {
  filename: 'src/main.ts',
  language: 'typescript',
  hunks: [
    {
      id: 'H0001',
      fileOrder: 1,
      original: { startLine: 1, lineCount: 1 },
      modified: { startLine: 1, lineCount: 2 },
    },
  ],
};

const bundle: ReviewBundle = {
  schemaVersion: BUNDLE_SCHEMA_VERSION,
  generatedAt: '2026-09-11T10:00:00.000Z',
  meta: {
    repo: 'a/r',
    title: 't',
    prNumber: null,
    baseRefName: null,
    headRefName: null,
    authorLogin: null,
    description: null,
    stats: null,
  },
  review: { prTitle: 't', overviewSummary: '', chapters: [] },
  files: {
    'src/main.ts': {
      base: { kind: 'content', content: 'one\ntwo\n' },
      head: { kind: 'content', content: 'one\ntwo\nthree\n' },
    },
  },
};

async function renderDiff() {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <EmbeddedFileSource bundle={bundle}>
          <InlineDiffChunk chunk={chunk} />
        </EmbeddedFileSource>
      ),
    },
  ]);
  render(<Stub initialEntries={['/']} />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  await screen.findByTestId('diff-editor');
}

describe('diff view preference', () => {
  beforeEach(() => {
    lastOptions.current = null;
    window.localStorage.clear();
    useDiffView.setState({ view: 'split' });
  });

  it('sets the two revisions side by side by default', async () => {
    await renderDiff();
    expect(lastOptions.current?.renderSideBySide).toBe(true);
  });

  it('stacks them into one column when the reader has asked for it', async () => {
    useDiffView.setState({ view: 'unified' });
    await renderDiff();
    expect(lastOptions.current?.renderSideBySide).toBe(false);
  });

  /*
   * Two panes of code in less than 900px is not a diff anyone can read, so the
   * editor's own collapse to the stacked view stays switched on even when the
   * reader has asked for side by side.
   */
  it('leaves the editor free to collapse a side-by-side diff in a narrow window', async () => {
    await renderDiff();
    expect(lastOptions.current?.useInlineViewWhenSpaceIsLimited).toBe(true);
    expect(lastOptions.current?.renderSideBySideInlineBreakpoint).toBe(900);
  });
});
