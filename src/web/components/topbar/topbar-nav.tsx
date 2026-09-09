import { Box, Group } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { token } from '@/web/theme/tokens';

const ITEMS = [
  { label: 'Reviews', href: '/', match: (p: string) => p === '/' },
  { label: 'Library', href: '/history', match: (p: string) => p.startsWith('/history') },
] as const;

/** Primary nav pills; hidden below the `sm` breakpoint. */
export function TopbarNav() {
  const { pathname } = useLocation();
  return (
    <Group component="nav" aria-label="Primary" gap={4} visibleFrom="sm" fz="sm">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Box
            key={item.href}
            component={Link}
            to={item.href}
            aria-current={active ? 'page' : undefined}
            px={12}
            py={4}
            fw={active ? 600 : undefined}
            style={{
              borderRadius: 999,
              textDecoration: 'none',
              color: active ? token('before') : token('muted-foreground'),
              background: active ? token('before-soft') : undefined,
              transition: 'color 120ms',
            }}
          >
            {item.label}
          </Box>
        );
      })}
    </Group>
  );
}
