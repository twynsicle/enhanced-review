import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@/web/test/render';
import Denied from './denied';

describe('denied route', () => {
  it('explains the allowlist and links back to the login form', async () => {
    const Stub = createRoutesStub([{ path: '/denied', Component: Denied }]);
    render(<Stub initialEntries={['/denied']} />);

    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Try a different account/ })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
