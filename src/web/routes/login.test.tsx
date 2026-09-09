import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@/web/test/render';
import Login from './login';

function stub(error: 'oauth' | null) {
  return createRoutesStub([{ path: '/login', Component: Login, loader: () => ({ error }) }]);
}

describe('login route', () => {
  it('posts the sign-in form to /auth/github', async () => {
    const Stub = stub(null);
    render(<Stub initialEntries={['/login']} />);

    const button = await screen.findByRole('button', { name: 'Sign in with GitHub' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/github');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Enhanced Review');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a banner when the OAuth round trip failed', async () => {
    const Stub = stub('oauth');
    render(<Stub initialEntries={['/login?error=oauth']} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('did not finish the sign-in');
  });
});
