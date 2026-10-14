import { Box, Group, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { BrandMark } from '@/report/chrome/brand-mark';
import { SHELL_MAX_WIDTH, SHELL_PX } from '@/report/chrome/page-shell';
import { token, TOPBAR_HEIGHT } from '@/report/theme/tokens';
import classes from './topbar.module.css';

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
        <div className={classes.start}>{start}</div>
        <Group gap={6} wrap="nowrap" className={classes.end}>
          {end}
        </Group>
      </Group>
    </Box>
  );
}

/** The mark and the name, as the header shows them; on a phone the mark alone. */
export function Brand() {
  return (
    <Box
      component="span"
      style={{
        display: 'inline-flex',
        flex: 'none',
        alignItems: 'center',
        gap: 10,
        color: token('foreground'),
      }}
    >
      <BrandMark size={48} />
      <Text component="span" fz="md" fw={600} visibleFrom="sm" style={{ letterSpacing: '-0.01em' }}>
        Enhanced&nbsp;Review
      </Text>
    </Box>
  );
}

/**
 * Which change this report is about, on every section. It links to the
 * summary, which is `#/`: the reader's hash state with no section named.
 */
export function TopbarChange({ tag, title }: { tag: string | null; title: string }) {
  return (
    <a href="#/" className={classes.change} title={tag === null ? title : `${tag} · ${title}`}>
      {tag !== null && <span className={classes.tag}>{tag}</span>}
      <span className={classes.title}>{title}</span>
    </a>
  );
}
