import { Box, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { BrandMark } from '@/web/components/brand-mark';
import { shellMaxWidth, SHELL_PX, type ShellWidth } from '@/web/components/page-shell';
import { token, TOPBAR_HEIGHT } from '@/web/theme/tokens';

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
 * and over the reader it follows the width toggle along with it.
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
        h={TOPBAR_HEIGHT}
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

/** The brand without the home link, for a page that has no app to go home to. */
export function StaticBrand() {
  return (
    <Box component="span" style={BRAND_STYLE}>
      <BrandLockup />
    </Box>
  );
}
