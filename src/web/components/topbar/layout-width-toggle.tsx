import { ActionIcon } from '@mantine/core';
import { IconViewportNarrow, IconViewportWide } from '@tabler/icons-react';
import { useEffect } from 'react';
import { bindLayoutWidth, useLayoutWidth } from '@/web/stores/layout-width';

/**
 * Flips the reader's width between the whole window (the default) and 110rem.
 * The store is rehydrated here, after mount, so SSR and the hydrating render
 * agree on `full`; the pre-paint script in `root.tsx` has already applied a
 * stored `wide` to `<html>`, so nothing flashes.
 *
 * The icon names the action rather than the state, as the scheme toggle beside
 * it does — a reader filling the window is offered the narrower page.
 */
export function LayoutWidthToggle() {
  const width = useLayoutWidth((s) => s.width);
  const toggle = useLayoutWidth((s) => s.toggle);
  useEffect(() => bindLayoutWidth(), []);

  const full = width === 'full';
  const label = full ? 'Switch to the narrower layout' : 'Switch to the full-width layout';
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {full ? <IconViewportNarrow size={18} /> : <IconViewportWide size={18} />}
    </ActionIcon>
  );
}
