import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';
import { READER_HANDLE } from '@/web/lib/reader-route';
import { useDiffWrap } from '@/web/stores/diff-wrap';
import { render, screen, userEvent } from '@/web/test/render';
import { Topbar } from './topbar';

const WIDTH_ROW = /^Layout:/;
const DIFF_ROW = /^Diffs:/;
const WRAP_ROW = /^Long lines:/;
const THEME_ROW = /^Theme:/;

/** Open the display menu, whose rows only exist once it is. */
async function openDisplayMenu(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
  // The dropdown mounts behind a transition, so its rows are not in the DOM on
  // the tick the click returns.
  await screen.findByRole('menu');
}

/** The topbar over a page that does or does not declare itself the reader. */
function renderOver(handle: unknown) {
  const Stub = createRoutesStub([
    {
      path: '/',
      handle,
      Component: () => <Topbar user={null} />,
    },
  ]);
  return render(<Stub initialEntries={['/']} />);
}

describe('Topbar', () => {
  it('offers the reader display preferences on the reader', async () => {
    renderOver(READER_HANDLE);
    await openDisplayMenu();
    expect(screen.getByRole('menuitem', { name: WIDTH_ROW })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: DIFF_ROW })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: WRAP_ROW })).toBeInTheDocument();
  });

  it('withholds them from a page that is a fixed width, where they would do nothing', async () => {
    renderOver(undefined);
    await openDisplayMenu();
    expect(screen.queryByRole('menuitem', { name: WIDTH_ROW })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: DIFF_ROW })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: WRAP_ROW })).not.toBeInTheDocument();
  });

  // The menu is offered everywhere, unlike the three toggles it replaced: a
  // page with no reading column still has a colour scheme.
  it('keeps the theme on a page that has no reader preferences', async () => {
    renderOver(undefined);
    await openDisplayMenu();
    expect(screen.getByRole('menuitem', { name: THEME_ROW })).toBeInTheDocument();
  });

  /*
   * These are settings rather than commands, and someone who has opened this to
   * stack the diffs often wants them narrower too. A menu that shut on the
   * first click would make them reopen it to find out whether it had worked —
   * so the row restates itself in place instead.
   */
  it('stays open across a change, and says what the setting became', async () => {
    useDiffWrap.setState({ wrap: 'off' });
    renderOver(READER_HANDLE);
    await openDisplayMenu();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Long lines: Not wrapped' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Long lines: Wrapped' })).toBeInTheDocument();
    expect(useDiffWrap.getState().wrap).toBe('on');
  });
});
