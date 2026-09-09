import { ActionIcon } from '@mantine/core';
import { IconArrowsDiagonal, IconArrowsDiagonalMinimize2 } from '@tabler/icons-react';
import { useEffect } from 'react';
import { bindLayoutWidth, useLayoutWidth } from '@/web/stores/layout-width';

/**
 * Flips the page max-width between narrow (default) and wide. The store is
 * rehydrated here, after mount, so SSR and the hydrating render agree on
 * `narrow`; the pre-paint script in `root.tsx` already applied the stored
 * width to `<html>`, so nothing flashes.
 */
export function LayoutWidthToggle() {
  const width = useLayoutWidth((s) => s.width);
  const toggle = useLayoutWidth((s) => s.toggle);
  useEffect(() => bindLayoutWidth(), []);

  const wide = width === 'wide';
  const label = `Switch to ${wide ? 'narrow' : 'wide'} layout`;
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {wide ? <IconArrowsDiagonalMinimize2 size={18} /> : <IconArrowsDiagonal size={18} />}
    </ActionIcon>
  );
}
