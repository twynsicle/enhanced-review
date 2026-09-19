import { Box, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { BrandMark } from '@/report/chrome/brand-mark';
import { SHELL_MAX_WIDTH, SHELL_PX } from '@/report/chrome/page-shell';
import { token, TOPBAR_HEIGHT } from '@/report/theme/tokens';

/**
 * Sticky, translucent header bar. Its inner bar takes its width and gutter
 * from `PageShell`, so the header always lines up with the page beneath it and
 * follows the width toggle along with it.
 */
export function TopbarFrame({ start, end }: { start: ReactNode; end: ReactNode }) {
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
        maw={SHELL_MAX_WIDTH}
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

/** The mark and the name, as the header shows them. */
export function Brand() {
  return (
    <Box
      component="span"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: token('foreground') }}
    >
      <BrandMark size={48} />
      <Text component="span" fz="md" fw={600} style={{ letterSpacing: '-0.01em' }}>
        Enhanced&nbsp;Review
      </Text>
    </Box>
  );
}
