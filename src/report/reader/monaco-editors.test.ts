import { afterEach, describe, expect, it, vi } from 'vitest';
import type { editor } from 'monaco-editor';
import { followSelectionInWindow } from '@/report/reader/monaco-editors';
import { TOPBAR_HEIGHT } from '@/report/theme/tokens';

type SelectionListener = (event: {
  source: string;
  selection: { getPosition: () => unknown };
}) => void;

/** An editor whose top sits at `editorTop` in the window, its selection `lineTop` px into it. */
function fakeEditor(editorTop: number, lineTop: number) {
  let listener: SelectionListener | null = null;
  const codeEditor = {
    onDidChangeCursorSelection: (next: SelectionListener) => {
      listener = next;
      return { dispose: () => {} };
    },
    getScrolledVisiblePosition: () => ({ top: lineTop, left: 0, height: 20 }),
    getDomNode: () => ({ getBoundingClientRect: () => ({ top: editorTop }) }),
  };
  followSelectionInWindow(codeEditor as unknown as editor.ICodeEditor);
  return (source: string) => listener?.({ source, selection: { getPosition: () => null } });
}

describe('followSelectionInWindow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('centres the window on a match find-next selected below the fold', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const select = fakeEditor(100, window.innerHeight * 3);
    select('api');
    expect(scrollTo).toHaveBeenCalledWith({
      top: window.scrollY + 100 + window.innerHeight * 3 - window.innerHeight / 2,
    });
  });

  it('scrolls back up to a match hidden under the topbar', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fakeEditor(-400, TOPBAR_HEIGHT)('keyboard');
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('leaves the window alone for a match already on screen, or a click', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    fakeEditor(0, window.innerHeight / 2)('api');
    fakeEditor(100, window.innerHeight * 3)('mouse');
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
