import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import type { DiffChunk } from '@/domain/review/narrative';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { render, screen, waitFor } from '@/web/test/render';
import { InlineDiffChunk } from './inline-diff-chunk';

/**
 * The editor's own file mocks a loader that resolves. This one is the other
 * half: a reader who cannot reach the CDN the editor is fetched from.
 *
 * `@monaco-editor/react` catches that failure itself and renders nothing
 * further, so what escapes is an unhandled rejection rather than a throw — no
 * error boundary sees it, and the card used to be left with a header over an
 * empty body. Hence a file of its own rather than a case in the editor's.
 */
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  loader: {
    config: () => {},
    init: () => Promise.reject(new Error('the CDN is unreachable')),
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

function renderChunk() {
  const bundle: ReviewBundle = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    generatedAt: '2026-09-11T10:00:00.000Z',
    meta: {
      repo: 'acme/widgets',
      title: 'A change',
      prNumber: null,
      baseRefName: null,
      headRefName: null,
      authorLogin: null,
      description: null,
      stats: null,
    },
    review: { prTitle: 'A change', overviewSummary: { lede: 'It changes things.' }, chapters: [] },
    files: {
      'src/main.ts': {
        base: { kind: 'content', content: 'one\n' },
        head: { kind: 'content', content: 'one\ntwo\n' },
      },
    },
  };
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
  return render(<Stub initialEntries={['/']} />);
}

describe('a diff whose editor never arrives', () => {
  it('says so in place of the editor', async () => {
    renderChunk();
    await waitFor(() => {
      expect(screen.getByText(/code viewer didn’t load/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('diff-editor')).not.toBeInTheDocument();
  });

  it('names reloading, and no library the reader has never heard of', async () => {
    renderChunk();
    const message = await screen.findByText(/code viewer didn’t load/);
    expect(message).toHaveTextContent(/reloading the page/i);
    expect(message.textContent ?? '').not.toMatch(/monaco/i);
  });
});
