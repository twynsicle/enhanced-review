import { createRoutesStub } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import Skeleton from '@/web/routes/skeleton';
import { COLOR_SCHEME_KEY } from '@/web/theme/color-scheme';
import { render, screen, userEvent } from './render';

const user = { id: 'u1', githubLogin: 'octocat', name: 'Octo', avatarUrl: null };
const Stub = createRoutesStub([{ path: '/', Component: Skeleton, loader: () => ({ user }) }]);

describe('skeleton route', () => {
  beforeEach(() => {
    window.localStorage.removeItem(COLOR_SCHEME_KEY);
    document.documentElement.removeAttribute('data-mantine-color-scheme');
  });

  it('renders inside the themed provider with the signed-in user', async () => {
    render(<Stub initialEntries={['/']} />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'The reviewer is ready when you are.',
    );
    expect(screen.getByText('Signed in as @octocat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
  });

  it('toggles the colour scheme and persists it under er-theme', async () => {
    render(<Stub initialEntries={['/']} />);
    const actor = userEvent.setup();

    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe('dark');

    await actor.click(await screen.findByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe('light');
    expect(window.localStorage.getItem(COLOR_SCHEME_KEY)).toBe('light');

    await actor.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe('dark');
    expect(window.localStorage.getItem(COLOR_SCHEME_KEY)).toBe('dark');
  });
});
