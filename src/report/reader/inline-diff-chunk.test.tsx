import { describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type EmbeddedSide, type ReviewBundle } from '@/review/bundle';
import type { DiffChunk, Insight } from '@/review/narrative';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { render, screen } from '@/report/test/render';
import { TOPBAR_HEIGHT } from '@/report/theme/tokens';
import { InlineDiffChunk } from './inline-diff-chunk';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  // The component pins the CDN and waits for the editor through this before
  // it mounts anything.
  loader: { config: () => {}, init: () => Promise.resolve({}) },
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

const content = (text: string): EmbeddedSide => ({ kind: 'content', content: text });

function renderChunk(files: ReviewBundle['files'], insights?: Insight[]) {
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
    review: { prTitle: 't', overviewSummary: { lede: '' }, chapters: [] },
    files,
  };
  return render(
    <EmbeddedFileSource bundle={bundle}>
      <InlineDiffChunk chunk={chunk} {...(insights ? { insights } : {})} />
    </EmbeddedFileSource>,
  );
}

const renderPair = (base: EmbeddedSide, head: EmbeddedSide) =>
  renderChunk({ [chunk.filename]: { base, head } });

describe('<InlineDiffChunk />', () => {
  it('shows the path and language, and a Monaco editor for both sides', async () => {
    renderPair(content('line1\nline2\n'), content('line1\nline2\nline3\n'));
    expect(screen.getByText('src/')).toBeDefined();
    expect(screen.getByText('main.ts')).toBeDefined();
    expect(screen.getByText('typescript')).toBeDefined();
    expect(screen.getByRole('figure', { name: 'Diff for src/main.ts' })).toBeDefined();
    expect(screen.getByText('Show full file')).toBeDefined();
    expect(await screen.findByTestId('diff-editor')).toBeDefined();
  });

  it('renders a too-large message when a side exceeds the embed limit', () => {
    renderPair({ kind: 'too-large' }, content('x'));
    expect(screen.getByText(/too large to preview/i)).toBeDefined();
    expect(screen.queryByText('Show full file')).toBeNull();
  });

  it('treats a one-side miss as a legitimately added or deleted file', () => {
    renderPair({ kind: 'absent' }, content('new file\n'));
    expect(screen.queryByText(/isn't available/i)).toBeNull();
    expect(screen.getByText('Show full file')).toBeDefined();
  });

  it('treats a both-sides miss as a real error', () => {
    renderPair({ kind: 'absent' }, { kind: 'absent' });
    expect(screen.getByText(/isn't available at either commit/i)).toBeDefined();
  });

  it('reads a file the bundle does not carry as missing', () => {
    renderChunk({});
    expect(screen.getByText(/isn't available at either commit/i)).toBeDefined();
  });
});

/*
 * The header follows the reader down a long diff, and what it sticks to is the
 * nearest scroll container. A card clipped with `overflow: hidden` is one, and
 * one that cannot scroll — so the offset resolved against the top of the card
 * instead of the viewport and parked the header over the first lines of the
 * diff. Nothing but a real layout can see that, hence the assertion on the
 * property rather than on a position.
 */
describe('<InlineDiffChunk /> sticky header', () => {
  it('sticks below the topbar, from a card that is not a scroll container', () => {
    renderPair(content('a\n'), content('b\n'));
    const card = screen.getByRole('figure', { name: 'Diff for src/main.ts' }) as HTMLElement;
    const header = card.firstElementChild as HTMLElement;

    expect(card.style.overflow).toBe('clip');
    expect(header.style.position).toBe('sticky');
    expect(header.style.top).toBe(`${TOPBAR_HEIGHT}px`);
  });
});

describe('<InlineDiffChunk /> with anchored insights', () => {
  it('draws them above the diff, and none when the chapter sent none', () => {
    const insight: Insight = {
      type: 'highlight',
      title: 'Why this constant is 14',
      text: 'Business days have no fixed calendar width.',
      filename: chunk.filename,
    };
    renderChunk({}, [insight]);
    renderChunk({});

    expect(screen.getAllByText('Why this constant is 14')).toHaveLength(1);
    expect(screen.getAllByText(/Risk/)).toHaveLength(1);
  });
});
