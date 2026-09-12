import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLE_SCHEMA_VERSION, type ReviewBundle } from '@/domain/review/bundle';
import type { DiffChunk } from '@/domain/review/narrative';
import { EmbeddedFileSource } from '@/web/components/narrative/file-source';
import { DisplayMenu } from '@/web/components/topbar/display-menu';
import { useDiffView } from '@/web/stores/diff-view';
import { bindDiffWrap, DIFF_WRAP_KEY, useDiffWrap } from '@/web/stores/diff-wrap';
import { act, render, screen, userEvent, waitFor } from '@/web/test/render';
import { InlineDiffChunk } from './inline-diff-chunk';

type Options = Record<string, unknown>;

/**
 * A stand-in for the diff widget that records what it is told, so the wrap
 * preference can be followed all the way to the editor API rather than only to
 * the props of a React element. `sides` is where the two settings meet: Monaco
 * pushes a widget-level option down to both inner editors, so anything set per
 * side is only safe while the widget is not told the same thing.
 *
 * `arrive` is the lazy chunk landing, held until a test calls it. Monaco is
 * loaded behind `lazy`, so `onMount` runs a commit or more after the component
 * that asked for it — and anything that component froze at its first render (a
 * ref mirrored during render, a value captured in a `[]` callback) only differs
 * inside that gap. A mock that calls back in the same commit makes the two read
 * alike and hides the difference; a timer makes the gap real but leaves which
 * side of it a test lands on to the scheduler.
 */
const widget = vi.hoisted(() => ({
  wraps: [] as unknown[],
  mounts: 0,
  options: {} as Options,
  sides: { original: {} as Options, modified: {} as Options },
  arrive: () => {},
}));

vi.mock('@monaco-editor/react', async () => {
  const { useEffect, useRef } = await import('react');
  const disposable = { dispose: () => {} };
  const side = (which: 'original' | 'modified') => ({
    updateOptions: (options: Options) => Object.assign(widget.sides[which], options),
    getContentHeight: () => 120,
    onDidContentSizeChange: () => disposable,
  });
  const original = side('original');
  const modified = side('modified');
  const diffEditor = {
    getOriginalEditor: () => original,
    getModifiedEditor: () => modified,
    onDidUpdateDiff: () => disposable,
    updateOptions: (options: Options) => {
      if ('diffWordWrap' in options) widget.wraps.push(options.diffWordWrap);
      Object.assign(widget.options, options);
      original.updateOptions(options);
      modified.updateOptions(options);
    },
    layout: () => {},
    getModel: () => null,
    setModel: () => {},
  };
  return {
    DiffEditor: ({
      onMount,
      options,
    }: {
      onMount: (instance: unknown) => void;
      options: Options;
    }) => {
      const arrived = useRef(false);
      useEffect(() => {
        widget.arrive = () => {
          arrived.current = true;
          widget.mounts += 1;
          onMount(diffEditor);
        };
        return () => {
          widget.arrive = () => {};
        };
      }, [onMount]);
      // The library re-applies the whole construction-options object whenever
      // its identity changes, which is what makes that object the wrong home
      // for anything set per side.
      useEffect(() => {
        if (arrived.current) diffEditor.updateOptions(options);
      }, [options]);
      return <div data-testid="diff-editor" />;
    },
  };
});

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

/** The toggle and a diff on the same page, the way the reader has them. */
async function renderReader() {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: () => (
        <EmbeddedFileSource bundle={bundle}>
          <DisplayMenu reader />
          <InlineDiffChunk chunk={chunk} />
        </EmbeddedFileSource>
      ),
    },
  ]);
  render(<Stub initialEntries={['/']} />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  await screen.findByTestId('diff-editor');
}

/** The lazy Monaco chunk landing, which `renderReader` deliberately stops short of. */
function monacoArrives(): void {
  act(() => widget.arrive());
}

const lastWrap = () => widget.wraps.at(-1);

/** What the store settles on with `stored` in localStorage and nothing else. */
function wrapAfterRehydrate(stored: string | null): string {
  if (stored === null) window.localStorage.removeItem(DIFF_WRAP_KEY);
  else window.localStorage.setItem(DIFF_WRAP_KEY, stored);
  bindDiffWrap();
  return useDiffWrap.getState().wrap;
}

describe('the wrap preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useDiffWrap.setState({ wrap: 'off' });
  });

  /*
   * Off is what the reader has today, and wrapping costs the one-row-per-line
   * correspondence a diff is read by — so it is a state a reader asks for,
   * never one they arrive at.
   */
  it('leaves long lines running off the edge when nothing is stored', () => {
    expect(wrapAfterRehydrate(null)).toBe('off');
  });

  it('wraps for a reader who has asked for it', () => {
    expect(wrapAfterRehydrate('on')).toBe('on');
  });

  it('ignores a value it does not recognise', () => {
    expect(wrapAfterRehydrate('sometimes')).toBe('off');
  });

  it('flips between the two stops', () => {
    const { toggle } = useDiffWrap.getState();
    toggle();
    expect(useDiffWrap.getState().wrap).toBe('on');
    toggle();
    expect(useDiffWrap.getState().wrap).toBe('off');
  });

  // Raw, not JSON, so the stored word is the one Monaco is handed and the one a
  // reader finds in devtools.
  it('round-trips the choice through storage', () => {
    useDiffWrap.getState().toggle();
    const stored = window.localStorage.getItem(DIFF_WRAP_KEY);
    expect(stored).toBe('on');

    // Resetting the store in memory writes back through `persist`, so the word
    // the toggle left has to be restored before the reload this stands in for.
    useDiffWrap.setState({ wrap: 'off' });
    expect(wrapAfterRehydrate(stored)).toBe('on');
  });
});

/**
 * The long-lines row of the display menu, opened. A dropdown does not render
 * its contents until it is opened, so every assertion about a row opens it.
 */
async function openWrapRow(): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
  return screen.findByRole('menuitem', { name: /^Long lines:/ });
}

describe('the wrap toggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    widget.wraps = [];
    widget.mounts = 0;
    widget.options = {};
    widget.sides = { original: {}, modified: {} };
    useDiffWrap.setState({ wrap: 'off' });
    useDiffView.setState({ view: 'split' });
  });

  it('offers wrapping, and names how it is currently set', async () => {
    render(<DisplayMenu reader />);
    expect(await openWrapRow()).toHaveAccessibleName('Long lines: Not wrapped');
  });

  it('names the other state once wrapping is on', async () => {
    useDiffWrap.setState({ wrap: 'on' });
    render(<DisplayMenu reader />);
    expect(await openWrapRow()).toHaveAccessibleName('Long lines: Wrapped');
  });

  it('reflows the editor in place rather than mounting a new one', async () => {
    await renderReader();
    monacoArrives();
    expect(lastWrap()).toBe('off');

    await userEvent.click(await openWrapRow());

    expect(lastWrap()).toBe('on');
    expect(widget.mounts).toBe(1);
  });

  // The reload: nothing but the stored word, rehydrated by the toggle and
  // followed by every editor on the page.
  it('comes back wrapped for a reader who chose it last time', async () => {
    window.localStorage.setItem(DIFF_WRAP_KEY, 'on');
    await renderReader();
    monacoArrives();
    expect(useDiffWrap.getState().wrap).toBe('on');
    expect(lastWrap()).toBe('on');
  });

  /*
   * The window the mirrored ref exists for: storage rehydrates while the lazy
   * chunk is still in flight, so the value the component froze at its first
   * render is already out of date when the editor finally asks for one.
   */
  it('hands a late-arriving editor the preference as it stands, not as it was', async () => {
    await renderReader();
    expect(widget.mounts).toBe(0);

    act(() => useDiffWrap.setState({ wrap: 'on' }));
    monacoArrives();

    expect(lastWrap()).toBe('on');
  });

  // Wrap is not in the construction options, so the object the view flip
  // replaces carries nothing that could undo it.
  it('keeps wrapping when the reader flips between split and unified', async () => {
    await renderReader();
    monacoArrives();
    await userEvent.click(await openWrapRow());

    act(() => useDiffView.setState({ view: 'unified' }));

    expect(widget.options.diffWordWrap).toBe('on');
  });

  /*
   * `wordWrapOverride2` is Monaco's lever, not ours: it pins the original side
   * to `off` whenever it computes that side's options for the stacked view —
   * which includes the widget's own construction, before the container has been
   * measured — and never clears it again. It outranks the override
   * `diffWordWrap` sets, so an unlifted pin leaves the original pane unwrapped
   * however often the preference is re-applied.
   */
  it('lifts the pin that would hold the original side unwrapped', async () => {
    window.localStorage.setItem(DIFF_WRAP_KEY, 'on');
    await renderReader();
    monacoArrives();

    expect(widget.sides.original.wordWrapOverride2).toBe('inherit');
  });

  // Re-pinned on the way through the stacked view, so coming back out of it has
  // to lift it again. The `off` here is Monaco's, standing in for that pass.
  it('lifts it again on the way back from the stacked view', async () => {
    window.localStorage.setItem(DIFF_WRAP_KEY, 'on');
    await renderReader();
    monacoArrives();
    widget.sides.original.wordWrapOverride2 = 'off';

    act(() => useDiffView.setState({ view: 'unified' }));

    expect(widget.sides.original.wordWrapOverride2).toBe('inherit');
  });

  // The other half of that bargain: a widget-level option reaches both inner
  // editors, so wrap arriving as one would take the snippet's line numbers with
  // it and every hunk would be numbered from 1.
  it('leaves the per-side line numbers alone when wrapping is turned on', async () => {
    await renderReader();
    monacoArrives();
    expect(typeof widget.sides.modified.lineNumbers).toBe('function');

    await userEvent.click(await openWrapRow());

    expect(typeof widget.sides.original.lineNumbers).toBe('function');
    expect(typeof widget.sides.modified.lineNumbers).toBe('function');
  });
});
