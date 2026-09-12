import { Box, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMark } from '@/web/components/brand-mark';
import { shellMaxWidth, SHELL_PX, type ShellWidth } from '@/web/components/page-shell';
import { ColorSchemeToggle } from '@/web/components/color-scheme-toggle';
import { useIsReader } from '@/web/lib/reader-route';
import { token } from '@/web/theme/tokens';
import { DiffViewToggle } from './diff-view-toggle';
import { DiffWrapToggle } from './diff-wrap-toggle';
import { LayoutWidthToggle } from './layout-width-toggle';
import { TopbarNav } from './topbar-nav';
import { UserMenu, type TopbarUser } from './user-menu';

/** The mark and the name, as the header shows them. */
export function BrandLockup() {
  return (
    <>
      <BrandMark size={48} />
      <Text component="span" fz="md" fw={600} style={{ letterSpacing: '-0.01em' }}>
        Enhanced&nbsp;Review
      </Text>
    </>
  );
}

const BRAND_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  textDecoration: 'none',
  color: token('foreground'),
} as const;

/**
 * Sticky, translucent header bar. Its inner bar takes its width and gutter
 * from `PageShell`, so the header always lines up with the page beneath it —
 * which means it has to be told which of the two page widths that page took,
 * and over the reader it follows the width toggle along with it. The app's
 * `Topbar` and the local report's header fill its two sides.
 */
export function TopbarFrame({
  start,
  end,
  width = 'page',
}: {
  start: ReactNode;
  end: ReactNode;
  width?: ShellWidth;
}) {
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
        maw={shellMaxWidth(width)}
        mx="auto"
        px={SHELL_PX}
        justify="space-between"
        gap={24}
        wrap="nowrap"
      >
        <Group gap={28} wrap="nowrap">
          {start}
        </Group>
        <Group gap={6} wrap="nowrap">
          {end}
        </Group>
      </Group>
    </Box>
  );
}

/**
 * The header shared by every page inside the app shell. The reader's display
 * preferences are offered only on the reader, where they do something; every
 * other page is a fixed width and has no use for either.
 */
export function Topbar({ user }: { user: TopbarUser | null }) {
  const reader = useIsReader();
  return (
    <TopbarFrame
      width={reader ? 'reader' : 'page'}
      start={
        <>
          <Box component={Link} to="/" aria-label="Enhanced Review — home" style={BRAND_STYLE}>
            <BrandLockup />
          </Box>
          <TopbarNav />
        </>
      }
      end={
        <>
          {reader && (
            <>
              <DiffViewToggle />
              <DiffWrapToggle />
              <LayoutWidthToggle />
            </>
          )}
          <ColorSchemeToggle />
          {user ? <UserMenu user={user} /> : null}
        </>
      }
    />
  );
}

/** The brand without the home link, for a page that has no app to go home to. */
export function StaticBrand() {
  return (
    <Box component="span" style={BRAND_STYLE}>
      <BrandLockup />
    </Box>
  );
}
