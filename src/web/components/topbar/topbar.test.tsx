import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';
import { READER_HANDLE } from '@/web/lib/reader-route';
import { render, screen } from '@/web/test/render';
import { Topbar } from './topbar';

const WIDTH_LABEL = /layout$/;
const DIFF_LABEL = /diffs/i;
const WRAP_LABEL = /long lines$/;

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
  it('offers the reader display preferences on the reader', () => {
    renderOver(READER_HANDLE);
    expect(screen.getByRole('button', { name: WIDTH_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DIFF_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WRAP_LABEL })).toBeInTheDocument();
  });

  it('withholds them from a page that is a fixed width, where they would do nothing', () => {
    renderOver(undefined);
    expect(screen.queryByRole('button', { name: WIDTH_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DIFF_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WRAP_LABEL })).not.toBeInTheDocument();
  });
});
