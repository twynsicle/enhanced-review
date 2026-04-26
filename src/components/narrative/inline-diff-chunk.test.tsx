import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => {
    function MockDiffEditor(): null {
      return null;
    }
    MockDiffEditor.displayName = 'MockDiffEditor';
    return MockDiffEditor;
  },
}));

import { render, screen, waitFor } from '@testing-library/react';
import type { DiffChunk } from '@enhanced-review/review-types';
import { InlineDiffChunk } from './inline-diff-chunk';

const baseChunk: DiffChunk = {
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

const PROPS = {
  chunk: baseChunk,
  owner: 'a',
  repo: 'r',
  baseRef: 'baseSha',
  headRef: 'headSha',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Returns a fetch implementation that produces a fresh `Response` object
 * for every call — needed because the component fires two requests (base
 * and head) and `Response` bodies are single-use.
 */
function fetchAlways(status: number, body: unknown): () => Promise<Response> {
  return () => Promise.resolve(jsonResponse(status, body));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<InlineDiffChunk />', () => {
  it('shows the filename + language badge before fetch resolves', () => {
    fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
    render(<InlineDiffChunk {...PROPS} />);

    expect(screen.getByText('src/main.ts')).toBeDefined();
    expect(screen.getByText('typescript')).toBeDefined();
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('renders the Monaco editor wrapper once both fetches resolve ok', async () => {
    fetchMock.mockImplementation(
      fetchAlways(200, {
        ok: true,
        data: { content: 'line1\nline2\n', language: 'typescript', lineCount: 3 },
      }),
    );
    const { container } = render(<InlineDiffChunk {...PROPS} />);

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

    expect(screen.getByText('Show full file')).toBeDefined();
    // Editor wrapper has an inline height style — confirms the snippet
    // mount sites are present.
    const editorWrappers = container.querySelectorAll('[style*="height"]');
    expect(editorWrappers.length).toBeGreaterThan(0);
  });

  it('renders a no-access message when GitHub returns 403', async () => {
    fetchMock.mockImplementation(
      fetchAlways(200, { ok: false, error: { kind: 'no-access', status: 403 } }),
    );

    render(<InlineDiffChunk {...PROPS} />);

    await waitFor(() =>
      expect(
        screen.queryByText(/don't have access to this repo on GitHub/i),
      ).not.toBeNull(),
    );

    // No Show full file toggle in the error state.
    expect(screen.queryByText('Show full file')).toBeNull();
  });

  it('renders a too-large message when the file exceeds 1MB', async () => {
    fetchMock.mockImplementation(
      fetchAlways(200, { ok: false, error: { kind: 'too-large' } }),
    );

    render(<InlineDiffChunk {...PROPS} />);

    await waitFor(() =>
      expect(screen.queryByText(/too large to preview/i)).not.toBeNull(),
    );
  });

  it('treats one-side-404 as a legitimate empty file (added or deleted)', async () => {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      call += 1;
      // First call (base) returns 404 — file added at head.
      if (call === 1) {
        return jsonResponse(200, {
          ok: false,
          error: { kind: 'not-found', status: 404 },
        });
      }
      return jsonResponse(200, {
        ok: true,
        data: { content: 'new file\n', language: 'typescript', lineCount: 2 },
      });
    });

    render(<InlineDiffChunk {...PROPS} />);

    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());

    // Renders Monaco wrapper, not the error body.
    expect(screen.queryByText(/don't have access/i)).toBeNull();
    expect(screen.getByText('Show full file')).toBeDefined();
  });

  it('treats both-sides-404 as a real error (likely lost repo access)', async () => {
    fetchMock.mockImplementation(
      fetchAlways(200, { ok: false, error: { kind: 'not-found', status: 404 } }),
    );

    render(<InlineDiffChunk {...PROPS} />);

    await waitFor(() =>
      expect(screen.queryByText(/GitHub returned 404/i)).not.toBeNull(),
    );
  });
});
