import { ActionIcon } from '@mantine/core';
import { IconLayoutColumns, IconLayoutRows } from '@tabler/icons-react';
import { useEffect } from 'react';
import {
  bindDiffView,
  selectSpaceLimited,
  useDiffView,
  useReaderColumn,
} from '@/web/stores/diff-view';

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
 *
 * Which is also why the icon follows what is drawn rather than what is stored.
 * Below `SIDE_BY_SIDE_MIN_WIDTH` the column cannot carry two panes and every
 * diff is stacked regardless, so the button shows stacked and is disabled: it
 * would otherwise claim a view the page is not in, and clicking it would do
 * nothing visible. The stored preference is untouched and comes back as soon as
 * there is room for it.
 */
export function DiffViewToggle() {
  const view = useDiffView((s) => s.view);
  const toggle = useDiffView((s) => s.toggle);
  const spaceLimited = useReaderColumn(selectSpaceLimited);
  useEffect(() => bindDiffView(), []);

  const split = !spaceLimited && view === 'split';
  const label = spaceLimited
    ? 'Diffs are stacked: the reading column is too narrow for two panes — widen the window or drag the sidebar in'
    : split
      ? 'Stack diffs into one column'
      : 'Show diffs side by side';
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      disabled={spaceLimited}
      onClick={toggle}
    >
      {split ? <IconLayoutColumns size={18} /> : <IconLayoutRows size={18} />}
    </ActionIcon>
  );
}
