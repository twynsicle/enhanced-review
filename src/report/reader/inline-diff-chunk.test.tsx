import type { DiffEditorProps } from '@monaco-editor/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type EmbeddedSide, type ReviewBundle } from '@/review/bundle';
import type { CitedHunk, DiffChunk, Insight } from '@/review/narrative';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { act, render, screen, userEvent, within } from '@/report/test/render';
import { useDimComments } from '@/report/stores/dim-comments';
import { useFileHeaders } from '@/report/stores/file-headers';
import { useCommentFade } from '@/report/stores/comment-fade';
import { useSkimFade } from '@/report/stores/skim-fade';
import { useSkimMarks } from '@/report/stores/skim-marks';
import { DisplayMenu } from '@/report/chrome/display-menu';
import { TOPBAR_HEIGHT } from '@/report/theme/tokens';
import { DIMMED_THEME } from './monaco-themes';
import { InlineDiffChunk } from './inline-diff-chunk';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ theme }: DiffEditorProps) => <div data-testid="diff-editor" data-theme={theme} />,
  // The component pins the CDN and waits for the editor through this before
  // it mounts anything.
  loader: { config: () => {}, init: () => Promise.resolve({ editor: { defineTheme: () => {} } }) },
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
      changedLines: 2,
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
  it('shows the path, whole in its hover, and a Monaco editor for both sides', async () => {
    renderPair(content('line1\nline2\n'), content('line1\nline2\nline3\n'));
    expect(screen.getByText('src/')).toBeDefined();
    expect(screen.getByText('main.ts').parentElement?.getAttribute('title')).toBe('src/main.ts');
    expect(screen.queryByText('typescript')).toBeNull();
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

describe('<InlineDiffChunk /> with comments dimmed', () => {
  beforeEach(() => useDimComments.setState({ comments: 'normal' }));

  it('is dimmed from the display menu, restyling the editor in place', async () => {
    renderPair(content('a\n'), content('// b\n'));
    render(<DisplayMenu />);
    const editor = await screen.findByTestId('diff-editor');
    expect(editor).toHaveAttribute('data-theme', 'vs-dark');

    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    const row = await screen.findByRole('menuitem', { name: /^Comments:/ });
    expect(row).toHaveAccessibleName('Comments: Normal');
    await userEvent.click(row);

    expect(useDimComments.getState().comments).toBe('dimmed');
    expect(row).toHaveAccessibleName('Comments: Dimmed');
    expect(screen.getByTestId('diff-editor')).toBe(editor);
    expect(editor).toHaveAttribute('data-theme', DIMMED_THEME.dark);
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
  const tiered = (hunks: Partial<CitedHunk>[]): ReturnType<typeof render> => {
    const cited: DiffChunk = {
      ...chunk,
      hunks: hunks.map((hunk, i) => ({
        id: `H000${String(i + 1)}`,
        fileOrder: i + 1,
        original: { startLine: i * 10 + 1, lineCount: 10 },
        modified: { startLine: i * 10 + 1, lineCount: 10 },
        changedLines: 10,
        tier: 'read',
        ...hunk,
      })),
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
      files: { [chunk.filename]: { base: content(lines), head: content(lines) } },
    };
    return render(
      <EmbeddedFileSource bundle={bundle}>
        <InlineDiffChunk chunk={cited} />
      </EmbeddedFileSource>,
    );
  };

  it('draws consecutive hunks of both tiers as one editor, with nothing folded', async () => {
    tiered([{}, { tier: 'skim' }, {}]);
    expect(await screen.findAllByTestId('diff-editor')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
  });

  it('tags each move in the header once, over all its lines, as a link to the other file', async () => {
    tiered([
      { movedFrom: { filename: 'src/old.ts', similarity: 92 } },
      { movedFrom: { filename: 'src/old.ts', similarity: 92 } },
      { tier: 'skim', whitespaceOnly: true },
    ]);
    await screen.findAllByTestId('diff-editor');
    const header = screen.getByText('main.ts').closest('div')!;
    const moved = within(header).getByText('Moved from src/old.ts, with edits · L1-20');
    expect(moved.getAttribute('title')).toBe(
      '92% of these lines match the lines removed from src/old.ts',
    );
    expect(moved.getAttribute('href')).toBe('#/?file=src%2Fold.ts');
    expect(within(header).getByRole('link', { name: /opens src\/old\.ts$/ })).toBe(moved);
    expect(within(header).queryByText(/Whitespace only/)).toBeNull();
  });

  it('tags a move within the file without linking it to itself', async () => {
    tiered([{ movedFrom: { filename: 'src/main.ts', similarity: 100 } }]);
    await screen.findAllByTestId('diff-editor');
    const header = screen.getByText('main.ts').closest('div')!;
    const moved = within(header).getByText('Moved unchanged from src/main.ts · L1-10');
    expect(moved.tagName).toBe('SPAN');
    expect(within(header).queryByRole('link')).toBeNull();
  });

  it('folds every file header onto one line from a chevron, and offers none with nothing to fold', async () => {
    useFileHeaders.setState({ headers: 'full' });
    tiered([{ movedFrom: { filename: 'src/old.ts', similarity: 100 } }]);
    await screen.findAllByTestId('diff-editor');
    const header = screen.getByText('main.ts').closest('div')!;
    expect(header.hasAttribute('data-one-line')).toBe(false);
    await userEvent.click(within(header).getByRole('button', { name: 'File headers on one line' }));
    expect(useFileHeaders.getState().headers).toBe('one-line');
    expect(header.hasAttribute('data-one-line')).toBe(true);
    const plain = tiered([{}]).container;
    await within(plain).findByTestId('diff-editor');
    expect(within(plain).queryByRole('button', { name: 'File headers on one line' })).toBeNull();
  });

  it('offers skim marks in the display menu, off until the reader asks', async () => {
    render(<DisplayMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    expect(await screen.findByRole('menuitem', { name: /^Skim hunks: Plain/ })).toBeDefined();
    expect(screen.queryByRole('slider', { name: 'Skim fade' })).toBeNull();
  });

  it('offers a strength for the fade once skim marks are on', async () => {
    useSkimMarks.setState({ marks: 'marked' });
    render(<DisplayMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    const slider = await screen.findByRole('slider', { name: 'Skim fade' });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(useSkimFade.getState().fade));
    useSkimMarks.setState({ marks: 'plain' });
  });

  it('offers a strength for dimmed comments only while they are dimmed', async () => {
    useDimComments.setState({ comments: 'dimmed' });
    render(<DisplayMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    const slider = await screen.findByRole('slider', { name: 'Comment fade' });
    expect(slider.getAttribute('aria-valuenow')).toBe(String(useCommentFade.getState().fade));
    act(() => useDimComments.setState({ comments: 'normal' }));
    expect(screen.queryByRole('slider', { name: 'Comment fade' })).toBeNull();
  });
});
