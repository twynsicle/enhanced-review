import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  BUNDLE_SCHEMA_VERSION,
  type EmbeddedSide,
  type ReviewBundle,
} from '@/domain/review/bundle';
import type { DiffChunk } from '@/domain/review/narrative';
import { EmbeddedFileSource, GithubFileSource } from '@/web/components/narrative/file-source';
import type { FileResponse } from '@/web/lib/github-api';
import { render, screen, waitFor } from '@/web/test/render';
import { InlineDiffChunk } from './inline-diff-chunk';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  // The component pins the CDN through this before it mounts anything.
  loader: { config: () => {} },
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

/** One side of the file, in the terms both sources can express. */
type Side = { content: string } | 'not-found' | 'too-large';

function githubSide(side: Side): FileResponse['base'] {
  if (side === 'not-found' || side === 'too-large') return { ok: false, error: { kind: side } };
  return {
    ok: true,
    data: {
      content: side.content,
      language: 'typescript',
      lineCount: side.content.split('\n').length,
    },
  };
}

function embeddedSide(side: Side): EmbeddedSide {
  if (side === 'not-found') return { kind: 'absent' };
  if (side === 'too-large') return { kind: 'too-large' };
  return { kind: 'content', content: side.content };
}

/** The chunk inside a router whose `/api/github/file` loader answers with `body`. */
function renderFromGithub(body: FileResponse | Promise<never>) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <GithubFileSource owner="a" repo="r" baseRef="baseSha" headRef="headSha">
          <InlineDiffChunk chunk={chunk} />
        </GithubFileSource>
      ),
    },
    { path: '/api/github/file', loader: () => body },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

function renderFromBundle(files: ReviewBundle['files']) {
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
    files,
  };
  // A router with no file route: an embedded source must never fetch.
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

const sources = {
  github: (base: Side, head: Side) =>
    renderFromGithub({ ok: true, base: githubSide(base), head: githubSide(head) }),
  embedded: (base: Side, head: Side) =>
    renderFromBundle({ [chunk.filename]: { base: embeddedSide(base), head: embeddedSide(head) } }),
};

describe.each(Object.entries(sources))('<InlineDiffChunk /> from %s', (_name, renderPair) => {
  it('renders one Monaco editor per snippet once both sides resolve', async () => {
    renderPair({ content: 'line1\nline2\n' }, { content: 'line1\nline2\nline3\n' });
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.getByText('Show full file')).toBeDefined();
    expect(await screen.findByTestId('diff-editor')).toBeDefined();
  });

  it('renders a too-large message when a side exceeds the blob limit', async () => {
    renderPair('too-large', { content: 'x' });
    await waitFor(() => expect(screen.queryByText(/too large to preview/i)).not.toBeNull());
  });

  it('treats a one-side miss as a legitimately added or deleted file', async () => {
    renderPair('not-found', { content: 'new file\n' });
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
    expect(screen.queryByText(/isn't available/i)).toBeNull();
    expect(screen.getByText('Show full file')).toBeDefined();
  });

  it('treats a both-sides miss as a real error', async () => {
    renderPair('not-found', 'not-found');
    await waitFor(() =>
      expect(screen.queryByText(/isn't available at either commit/i)).not.toBeNull(),
    );
  });
});

describe('<InlineDiffChunk /> from github', () => {
  it('shows the filename + language badge before the fetch resolves', () => {
    renderFromGithub(new Promise<never>(() => {}));
    expect(screen.getByText('src/')).toBeDefined();
    expect(screen.getByText('main.ts')).toBeDefined();
    expect(screen.getByText('typescript')).toBeDefined();
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(screen.getByRole('figure', { name: 'Diff for src/main.ts' })).toBeDefined();
  });

  it('renders a no-access message when GitHub answers 403', async () => {
    renderFromGithub({
      ok: true,
      base: { ok: false, error: { kind: 'no-access' } },
      head: { ok: false, error: { kind: 'no-access' } },
    });
    await waitFor(() =>
      expect(screen.queryByText(/don't have access to this repo on GitHub/i)).not.toBeNull(),
    );
    expect(screen.queryByText('Show full file')).toBeNull();
  });
});

describe('<InlineDiffChunk /> from embedded', () => {
  it('reads a file the bundle does not carry as missing, not as loading', () => {
    renderFromBundle({});
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByText(/isn't available at either commit/i)).toBeDefined();
  });
});
