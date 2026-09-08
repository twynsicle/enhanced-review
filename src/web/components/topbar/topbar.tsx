import { Box, Group, Text } from '@mantine/core';
import { Link } from 'react-router';
import { BrandMark } from '@/web/components/brand-mark';
import { ColorSchemeToggle } from '@/web/components/color-scheme-toggle';
import { token } from '@/web/theme/tokens';
import { LayoutWidthToggle } from './layout-width-toggle';
import { TopbarNav } from './topbar-nav';
import { UserMenu, type TopbarUser } from './user-menu';

/**
 * Sticky, translucent header shared by every page inside the app shell. Its
 * inner bar follows `--review-max-width` so the wide-layout toggle widens
 * the topbar together with the reader.
 */
export function Topbar({ user }: { user: TopbarUser | null }) {
  return (
    <Box
      component="header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        borderBottom: `1px solid ${token('border')}`,
        background: `color-mix(in oklab, ${token('background')} 70%, transparent)`,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <Group
        h={56}
        maw="var(--review-max-width, 92rem)"
        mx="auto"
        px={{ base: 20, sm: 28 }}
        justify="space-between"
        gap={24}
        wrap="nowrap"
      >
        <Group gap={28} wrap="nowrap">
          <Box
            component={Link}
            to="/"
            aria-label="Enhanced Review — home"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              color: token('foreground'),
            }}
          >
            <BrandMark size={48} />
            <Text
              component="span"
              ff="heading"
              fz={15}
              fw={600}
              style={{ letterSpacing: '-0.01em' }}
            >
              Enhanced&nbsp;Review
            </Text>
          </Box>
          <TopbarNav />
        </Group>
        <Group gap={6} wrap="nowrap">
          <LayoutWidthToggle />
          <ColorSchemeToggle />
          {user ? <UserMenu user={user} /> : null}
        </Group>
      </Group>
    </Box>
  );
}
