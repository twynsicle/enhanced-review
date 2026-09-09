import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@/web/test/render';
import Relink from './relink';

describe('relink route', () => {
  it('re-runs the GitHub OAuth flow via POST /auth/github', async () => {
    const Stub = createRoutesStub([{ path: '/relink', Component: Relink, loader: () => null }]);
    render(<Stub initialEntries={['/relink']} />);

    const button = await screen.findByRole('button', { name: 'Re-link GitHub' });
    expect(button.closest('form')).toHaveAttribute('action', '/auth/github');
    expect(
      screen.getByRole('heading', { name: 'Re-link your GitHub account' }),
    ).toBeInTheDocument();
  });
});
