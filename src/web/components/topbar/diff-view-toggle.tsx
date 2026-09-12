import { ActionIcon } from '@mantine/core';
import { IconLayoutColumns, IconLayoutRows } from '@tabler/icons-react';
import { useEffect } from 'react';
import { bindDiffView, useDiffView } from '@/web/stores/diff-view';

/**
 * Flips every diff in the reader between side by side (the default) and
 * stacked. Sits beside the width toggle because the two are usually turned
 * together: two panes of code want the whole window, one column does not.
 *
 * Rehydrated here on mount for the same reason the width toggle is. The icon
 * names the current state, unlike the scheme toggle next to it, which names
 * the action: which way the page is lit needs no icon to say so, whereas the
 * diffs are often scrolled out of sight, and then the icon is the only thing
 * left saying how they are set.
 */
export function DiffViewToggle() {
  const view = useDiffView((s) => s.view);
  const toggle = useDiffView((s) => s.toggle);
  useEffect(() => bindDiffView(), []);

  const split = view === 'split';
  const label = split ? 'Stack diffs into one column' : 'Show diffs side by side';
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {split ? <IconLayoutColumns size={18} /> : <IconLayoutRows size={18} />}
    </ActionIcon>
  );
}
