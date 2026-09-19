import { Box } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';

/**
 * The `maw` for the page and for the topbar above it, so the header lines up
 * with the content beneath it at any window size and the width toggle moves
 * both together. `--review-max-width` is emitted by the Mantine CSS variables
 * resolver and overwritten on `<html>` by the layout-width store; the fallback
 * covers a render outside the provider.
 *
 * Widening the shell is deliberately not the same as widening the text. Prose
 * keeps its own measure in `ch` — a 110rem line of body copy is unreadable, let
 * alone a full-window one — so the extra room goes to what can use it: the
 * reader's diffs, code blocks and diagrams.
 */
export const SHELL_MAX_WIDTH = 'var(--review-max-width, 100%)';

/** Horizontal gutter, shared with the topbar so nothing sits half a step off. */
export const SHELL_PX = { base: 20, sm: 28 };

/**
 * A page ends with more room than it starts with. Symmetric padding made every
 * page stop flush against its last element, which reads as the content having
 * been cut off rather than finished.
 */
const SHELL_PB = { base: 72, sm: 96 };

export function PageShell({
  children,
  py = { base: 40, sm: 48 },
  style,
}: {
  children: ReactNode;
  /** Top padding. The bottom is always `SHELL_PB` — see the note above it. */
  py?: number | { base: number; sm: number };
  style?: CSSProperties;
}) {
  return (
    <Box
      component="main"
      mx="auto"
      w="100%"
      maw={SHELL_MAX_WIDTH}
      px={SHELL_PX}
      pt={py}
      pb={SHELL_PB}
      style={style}
    >
      {children}
    </Box>
  );
}
