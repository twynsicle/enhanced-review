import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import type { DiffChunk } from '@/domain/review/narrative';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { DisplayMenu } from '@/web/components/topbar/display-menu';
import {
  DIFF_VIEW_KEY,
  selectSpaceLimited,
  SIDE_BY_SIDE_MIN_WIDTH,
  useDiffView,
  useReaderColumn,
} from '@/web/stores/diff-view';
import { render, screen, userEvent, waitFor } from '@/web/test/render';
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

/** Back to the defaults: the stored preference, and an unmeasured column. */
function resetDiffView(): void {
  window.localStorage.clear();
  useDiffView.setState({ view: 'split' });
  useReaderColumn.setState({ columnWidth: null });
}

describe('diff view preference', () => {
  beforeEach(() => {
    lastOptions.current = null;
    resetDiffView();
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
    useDiffView.setState({ view: 'split' });
    useReaderColumn.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH - 1 });
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
    // Monaco goes inline at `width <= breakpoint`, so the breakpoint is the
    // widest column that collapses — one pixel under the store's minimum.
    expect(lastOptions.current?.renderSideBySideInlineBreakpoint).toBe(SIDE_BY_SIDE_MIN_WIDTH - 1);
  });

  /*
   * The off-by-one this pins: the store's threshold is exclusive and Monaco's
   * breakpoint inclusive, so the pair only agree if the constant handed to the
   * editor is one lower. At the two widths either side of the boundary, what
   * the reader decides and what the editor would decide must match.
   */
  it.each([
    { width: SIDE_BY_SIDE_MIN_WIDTH, sideBySide: true },
    { width: SIDE_BY_SIDE_MIN_WIDTH - 1, sideBySide: false },
  ])('agrees with the editor at a column of $width', async ({ width, sideBySide }) => {
    useDiffView.setState({ view: 'split' });
    useReaderColumn.setState({ columnWidth: width });
    await renderDiff();
    expect(lastOptions.current?.renderSideBySide).toBe(sideBySide);
    // Monaco's own rule, from diffEditorOptions.js.
    const breakpoint = lastOptions.current?.renderSideBySideInlineBreakpoint as number;
    expect(width <= breakpoint).toBe(!sideBySide);
  });
});

/**
 * The diffs row of the display menu, opened. The settings live behind a menu
 * now, and a dropdown does not render its contents until it is opened, so every
 * assertion about a row has to open it first.
 */
async function openDiffsRow(): Promise<HTMLElement> {
  render(<DisplayMenu reader />);
  await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
  return screen.findByRole('menuitem', { name: /^Diffs:/ });
}

describe('the display menu in a column too narrow for two panes', () => {
  beforeEach(resetDiffView);

  it('reads as stacked and stops offering a choice that would do nothing', async () => {
    useReaderColumn.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH - 1 });
    const row = await openDiffsRow();
    expect(row).toBeDisabled();
    expect(row).toHaveAccessibleName(/too narrow/i);
  });

  it('offers it again as soon as there is room, with the preference intact', async () => {
    useReaderColumn.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH + 100 });
    const row = await openDiffsRow();
    expect(row).toBeEnabled();
    expect(row).toHaveAccessibleName('Diffs: Side by side');
    expect(useDiffView.getState().view).toBe('split');
  });

  // The boundary itself: `SIDE_BY_SIDE_MIN_WIDTH` is the narrowest column that
  // still gets two panes, and the pixel below it is the widest that does not.
  it.each([
    { width: SIDE_BY_SIDE_MIN_WIDTH, limited: false },
    { width: SIDE_BY_SIDE_MIN_WIDTH - 1, limited: true },
  ])('calls a column of $width space-limited: $limited', ({ width, limited }) => {
    useReaderColumn.setState({ columnWidth: width });
    expect(selectSpaceLimited(useReaderColumn.getState())).toBe(limited);
  });

  /*
   * And the toggle agrees at the boundary. The pixel below it is the first case
   * in this block; this is the one width where an off-by-one in either
   * comparison would show, so it gets its own case rather than a parameter —
   * `no-conditional-expect` rules out picking the matcher from the table, and
   * the raw `disabled` DOM property is not the same question as the matchers,
   * which also read `aria-disabled` and Mantine's `data-disabled`.
   */
  it('still offers the choice at exactly the minimum width', async () => {
    useReaderColumn.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH });
    expect(await openDiffsRow()).toBeEnabled();
  });

  it('leaves the preference alone while it cannot be honoured', () => {
    useDiffView.setState({ view: 'unified' });
    useReaderColumn.setState({ columnWidth: null });
    expect(selectSpaceLimited(useReaderColumn.getState())).toBe(false);
    useReaderColumn.setState({ columnWidth: SIDE_BY_SIDE_MIN_WIDTH - 1 });
    expect(selectSpaceLimited(useReaderColumn.getState())).toBe(true);
    expect(useDiffView.getState().view).toBe('unified');
  });
});

/*
 * The measured column used to be a field on the persisted store, and zustand's
 * `persist` writes the partialized slice after every `set` without comparing it
 * first. Since `chapter-reader.tsx` republishes the width from a ResizeObserver
 * — once per animation frame for as long as the sidebar handle is dragged —
 * that meant a synchronous `localStorage.setItem` per frame, every one of them
 * writing back the same unchanged word.
 */
describe('measuring the column', () => {
  beforeEach(resetDiffView);

  it('never touches storage, however many times the width is republished', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    const { setColumnWidth } = useReaderColumn.getState();
    for (let width = 700; width < 1100; width += 20) setColumnWidth(width);
    // And the unmount path, which reports the absence of a measurement.
    setColumnWidth(null);

    expect(setItem).not.toHaveBeenCalled();
    expect(selectSpaceLimited(useReaderColumn.getState())).toBe(false);
    setItem.mockRestore();
  });

  it('still persists the preference itself, which is what storage is for', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    useDiffView.getState().toggle();

    expect(setItem).toHaveBeenCalledWith(DIFF_VIEW_KEY, 'unified');
    setItem.mockRestore();
  });
});
