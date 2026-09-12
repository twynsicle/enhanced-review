import { ActionIcon } from '@mantine/core';
import { IconLayoutColumns, IconLayoutRows } from '@tabler/icons-react';
import { useEffect } from 'react';
import { bindDiffView, useDiffView } from '@/web/stores/diff-view';

/**
 * Flips every diff in the reader between side by side (the default) and
 * stacked. Sits beside the width toggle because the two are usually turned
 * together: two panes of code want the whole window, one column does not.
 *
 * Rehydrated here on mount for the same reason the width toggle is, and the
 * icon likewise names the action rather than the state.
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
      {split ? <IconLayoutRows size={18} /> : <IconLayoutColumns size={18} />}
    </ActionIcon>
  );
}
