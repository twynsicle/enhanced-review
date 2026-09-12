import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import type { DiffChunk } from '@/domain/review/narrative';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { DiffViewToggle } from '@/web/components/topbar/diff-view-toggle';
import { selectSpaceLimited, SIDE_BY_SIDE_MIN_WIDTH, useDiffView } from '@/web/stores/diff-view';
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
    useDiffView.setState({ view: 'split', columnWidth: null });
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

  it('stacks them whatever the preference once the column is too narrow', async () => {
    useDiffView.setState({ view: 'split', columnWidth: SIDE_BY_SIDE_MIN_WIDTH - 1 });
    await renderDiff();
    expect(lastOptions.current?.renderSideBySide).toBe(false);
  });

  /*
   * The reader's own measurement has already forced the stacked view above;
   * the editor's identical rule is the backstop for a diff mounted somewhere
   * that measures nothing, and the two share a threshold so they cannot part
   * company.
   */
  it('leaves the editor its own collapse, on the same threshold', async () => {
    await renderDiff();
    expect(lastOptions.current?.useInlineViewWhenSpaceIsLimited).toBe(true);
    expect(lastOptions.current?.renderSideBySideInlineBreakpoint).toBe(SIDE_BY_SIDE_MIN_WIDTH);
  });
});

describe('the toggle in a column too narrow for two panes', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDiffView.setState({ view: 'split', columnWidth: null });
  });

  it('reads as stacked and stops offering a choice that would do nothing', () => {
    useDiffView.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH - 1 });
    render(<DiffViewToggle />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName(/too narrow/i);
  });

  it('offers it again as soon as there is room, with the preference intact', () => {
    useDiffView.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH });
    render(<DiffViewToggle />);
    const button = screen.getByRole('button');
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName('Stack diffs into one column');
    expect(useDiffView.getState().view).toBe('split');
  });

  it('leaves the preference alone while it cannot be honoured', () => {
    useDiffView.setState({ view: 'unified', columnWidth: null });
    expect(selectSpaceLimited(useDiffView.getState())).toBe(false);
    useDiffView.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH - 1 });
    expect(selectSpaceLimited(useDiffView.getState())).toBe(true);
    expect(useDiffView.getState().view).toBe('unified');
  });
});
