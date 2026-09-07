import { beforeEach, describe, expect, it } from 'vitest';
import Skeleton from '@/web/routes/skeleton';
import { COLOR_SCHEME_KEY } from '@/web/theme/color-scheme';
import { render, screen, userEvent } from './render';

describe('skeleton route', () => {
  beforeEach(() => {
    window.localStorage.removeItem(COLOR_SCHEME_KEY);
    document.documentElement.removeAttribute('data-mantine-color-scheme');
  });

  it('renders inside the themed provider', () => {
    render(<Skeleton />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'The reviewer is ready when you are.',
    );
    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
  });

  it('toggles the colour scheme and persists it under er-theme', async () => {
    render(<Skeleton />);
    const user = userEvent.setup();

    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe('light');
    expect(window.localStorage.getItem(COLOR_SCHEME_KEY)).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement.getAttribute('data-mantine-color-scheme')).toBe('dark');
    expect(window.localStorage.getItem(COLOR_SCHEME_KEY)).toBe('dark');
  });
});
