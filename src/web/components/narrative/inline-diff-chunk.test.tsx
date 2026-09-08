import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { DiffChunk } from '@/domain/review/narrative';
import type { FileResponse } from '@/web/lib/github-api';
import { render, screen, waitFor } from '@/web/test/render';
import { InlineDiffChunk } from './inline-diff-chunk';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
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

const ok = (content: string) => ({
  ok: true as const,
  data: { content, language: 'typescript', lineCount: content.split('\n').length },
});
const fail = (kind: 'no-access' | 'not-found' | 'too-large') => ({
  ok: false as const,
  error: { kind },
});

/** The chunk inside a router whose `/api/github/file` loader answers with `body`. */
function renderChunk(body: FileResponse | Promise<never>) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <InlineDiffChunk chunk={chunk} owner="a" repo="r" baseRef="baseSha" headRef="headSha" />
      ),
    },
    { path: '/api/github/file', loader: () => body },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

describe('<InlineDiffChunk />', () => {
  it('shows the filename + language badge before the fetch resolves', () => {
    renderChunk(new Promise<never>(() => {}));
    expect(screen.getByText('src/')).toBeDefined();
    expect(screen.getByText('main.ts')).toBeDefined();
    expect(screen.getByText('typescript')).toBeDefined();
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.getByRole('figure', { name: 'Diff for src/main.ts' })).toBeDefined();
  });

  it('renders one Monaco editor per snippet once both sides resolve', async () => {
    renderChunk({ ok: true, base: ok('line1\nline2\n'), head: ok('line1\nline2\nline3\n') });
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByText('Show full file')).toBeDefined();
    expect(await screen.findByTestId('diff-editor')).toBeDefined();
  });

  it('renders a no-access message when GitHub answers 403', async () => {
    renderChunk({ ok: true, base: fail('no-access'), head: fail('no-access') });
    await waitFor(() =>
      expect(screen.queryByText(/don't have access to this repo on GitHub/i)).not.toBeNull(),
    );
    expect(screen.queryByText('Show full file')).toBeNull();
  });

  it('renders a too-large message when the file exceeds the blob limit', async () => {
    renderChunk({ ok: true, base: fail('too-large'), head: ok('x') });
    await waitFor(() => expect(screen.queryByText(/too large to preview/i)).not.toBeNull());
  });

  it('treats a one-side 404 as a legitimately added or deleted file', async () => {
    renderChunk({ ok: true, base: fail('not-found'), head: ok('new file\n') });
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.queryByText(/don't have access/i)).toBeNull();
    expect(screen.getByText('Show full file')).toBeDefined();
  });

  it('treats a both-sides 404 as a real error', async () => {
    renderChunk({ ok: true, base: fail('not-found'), head: fail('not-found') });
    await waitFor(() => expect(screen.queryByText(/GitHub returned 404/i)).not.toBeNull());
  });
});
