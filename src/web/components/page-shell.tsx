import { Box } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';

/**
 * The one page width. Every page inside the app shell — and the topbar's own
 * inner bar — is this wide, so the header lines up with the content beneath it
 * at any window size and both follow the narrow/wide toggle together. Before
 * this existed the topbar was on `--review-max-width` while the pages were on
 * three different fixed `Container` sizes, so the header was wider than its
 * own page and the toggle appeared to do nothing outside the reader.
 *
 * The fallback matters: `--review-max-width` is emitted by the Mantine CSS
 * variables resolver and overwritten on `<html>` before paint by the script in
 * `root.tsx`, but a page rendered outside the provider still needs a width.
 *
 * Widening the shell is deliberately not the same as widening the text. Prose
 * keeps its own `maw` in `ch` — a 110rem line of body copy is unreadable — so
 * the extra room goes to what can use it: the composer's fields, list rows and
 * the reader's two columns. A page whose content does not benefit from the
 * width caps it and stays left-aligned, so the left edge never moves between
 * pages.
 */
export const SHELL_MAX_WIDTH = 'var(--review-max-width, 92rem)';

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
