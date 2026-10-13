import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type EmbeddedSide, type ReviewBundle } from '@/review/bundle';
import type { CitedHunk, DiffChunk, Insight } from '@/review/narrative';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { act, render, screen, userEvent, within } from '@/report/test/render';
import { useFoldSkim } from '@/report/stores/fold-skim';
import { DisplayMenu } from '@/report/chrome/display-menu';
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
      tier: 'read',
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

describe('<InlineDiffChunk /> by attention tier', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${String(i + 1)}`).join('\n');
  const tiered = (hunks: Partial<CitedHunk>[], fold?: boolean): ReturnType<typeof render> => {
    const cited: DiffChunk = {
      ...chunk,
      hunks: hunks.map((hunk, i) => ({
        id: `H000${String(i + 1)}`,
        fileOrder: i + 1,
        original: { startLine: i * 10 + 1, lineCount: 10 },
        modified: { startLine: i * 10 + 1, lineCount: 10 },
        tier: 'read',
        ...hunk,
      })),
    };
    const bundle: ReviewBundle = {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      generatedAt: '2026-09-11T10:00:00.000Z',
      meta: {
        repo: 'a/r',
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
      files: { [chunk.filename]: { base: content(lines), head: content(lines) } },
    };
    return render(
      <EmbeddedFileSource bundle={bundle}>
        <InlineDiffChunk chunk={cited} {...(fold === undefined ? {} : { fold })} />
      </EmbeddedFileSource>,
    );
  };

  beforeEach(() => useFoldSkim.setState({ skim: 'shown' }));

  it('draws consecutive hunks of one tier as one group, and a change of tier as another', async () => {
    tiered([{}, {}, { tier: 'skim' }]);
    expect(await screen.findAllByTestId('diff-editor')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Read lines' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Skim lines' })).toBeDefined();
  });

  it('folds a mechanical group to one row saying what it is, and opens it in place', async () => {
    tiered([
      {},
      { tier: 'mechanical', reason: 'imports for the new helper' },
      { tier: 'mechanical', reason: 'the same rename at 14 call sites' },
    ]);
    expect(await screen.findAllByTestId('diff-editor')).toHaveLength(1);

    const group = screen.getByRole('group', { name: 'Mechanical lines' });
    expect(within(group).getByText('Mechanical')).toBeDefined();
    expect(
      within(group).getByText('imports for the new helper · the same rename at 14 call sites'),
    ).toBeDefined();
    expect(within(group).getByText('20 lines')).toBeDefined();
    const show = within(group).getByRole('button', { name: 'Show' });
    expect(show.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(show);
    expect(await screen.findAllByTestId('diff-editor')).toHaveLength(2);
    expect(within(group).getByRole('button', { name: 'Hide' })).toBeDefined();
  });

  it('folds skim only when the reader has asked for it', async () => {
    tiered([{}, { tier: 'skim' }]);
    expect(await screen.findAllByTestId('diff-editor')).toHaveLength(2);
    const group = screen.getByRole('group', { name: 'Skim lines' });
    expect(within(group).queryByRole('button')).toBeNull();

    act(() => useFoldSkim.setState({ skim: 'folded' }));
    expect(screen.getAllByTestId('diff-editor')).toHaveLength(1);
    expect(within(group).getByRole('button', { name: 'Show' })).toBeDefined();
  });

  it('badges the facts on the group’s row, even on a group that is read', async () => {
    tiered([
      { movedFrom: { filename: 'src/old.ts', similarity: 92 } },
      { tier: 'mechanical', reason: 'reformatted', whitespaceOnly: true },
    ]);
    await screen.findAllByTestId('diff-editor');
    const read = screen.getByRole('group', { name: 'Read lines' });
    expect(within(read).getByText('Moved from src/old.ts · 92%')).toBeDefined();
    expect(within(read).queryByText('Read')).toBeNull();
    const mechanical = screen.getByRole('group', { name: 'Mechanical lines' });
    expect(within(mechanical).getByText('Whitespace only')).toBeDefined();
  });

  it('is folded from the display menu, which names how skim is set', async () => {
    render(<DisplayMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    const row = await screen.findByRole('menuitem', { name: /^Skim:/ });
    expect(row).toHaveAccessibleName('Skim: Shown');

    await userEvent.click(row);
    expect(useFoldSkim.getState().skim).toBe('folded');
    expect(row).toHaveAccessibleName('Skim: Folded');
  });

  it('never folds where it is told not to, the file view', async () => {
    useFoldSkim.setState({ skim: 'folded' });
    tiered([{ tier: 'skim' }, { tier: 'mechanical', reason: 'boilerplate' }], false);
    expect(await screen.findAllByTestId('diff-editor')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    // The row still says what the chapters made of the lines.
    expect(screen.getByText('boilerplate')).toBeDefined();
  });
});
