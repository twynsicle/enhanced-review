import { Box } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';
import { PAGE_MAX_WIDTH } from '@/web/theme/tokens';

/**
 * Which of the two page widths this page takes.
 *
 * `reader` follows the width toggle, because the reader is the only page whose
 * content — a side-by-side diff — is better for every pixel it is given.
 * `page` is a fixed width for everything else: a composer field or a history
 * row spread across a 3400px monitor is worse, not better, so those pages have
 * no stake in the choice and do not offer it.
 */
export type ShellWidth = 'page' | 'reader';

/**
 * The `maw` for a page and for the topbar above it. Every page inside the app
 * shell renders through `PageShell`, and the topbar's own inner bar takes its
 * width from here too, so the header lines up with the content beneath it at
 * any window size and the toggle moves both together. Before this existed the
 * topbar was on `--review-max-width` while the pages were on three different
 * fixed `Container` sizes, so the header was wider than its own page and the
 * toggle appeared to do nothing outside the reader.
 *
 * The fallback matters: `--review-max-width` is emitted by the Mantine CSS
 * variables resolver and overwritten on `<html>` before paint by the script in
 * `root.tsx`, but a page rendered outside the provider still needs a width.
 *
 * Widening the shell is deliberately not the same as widening the text. Prose
 * keeps its own measure in `ch` — a 110rem line of body copy is unreadable, let
 * alone a full-window one — so the extra room goes to what can use it: the
 * reader's diffs, code blocks and diagrams. A page whose content does not
 * benefit from the width caps it and stays left-aligned, so the left edge never
 * moves between pages.
 */
export function shellMaxWidth(width: ShellWidth): string {
  return width === 'reader' ? 'var(--review-max-width, 100%)' : PAGE_MAX_WIDTH;
}

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
  width = 'page',
  style,
}: {
  children: ReactNode;
  /** Top padding. The bottom is always `SHELL_PB` — see the note above it. */
  py?: number | { base: number; sm: number };
  /** Defaults to the fixed page width; the reader opts into the toggle. */
  width?: ShellWidth;
  style?: CSSProperties;
}) {
  return (
    <Box
      component="main"
      mx="auto"
      w="100%"
      maw={shellMaxWidth(width)}
      px={SHELL_PX}
      pt={py}
      pb={SHELL_PB}
      style={style}
    >
      {children}
    </Box>
  );
}
