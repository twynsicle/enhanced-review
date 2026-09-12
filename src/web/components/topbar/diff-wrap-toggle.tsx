import { ActionIcon } from '@mantine/core';
import { IconTextWrap, IconTextWrapDisabled } from '@tabler/icons-react';
import { useEffect } from 'react';
import { bindDiffWrap, useDiffWrap } from '@/web/stores/diff-wrap';

/**
 * Soft-wraps every diff in the reader, or lets long lines run off the edge.
 * Sits with the other two reader preferences because all three answer the same
 * question — how much room a line of code gets, and what happens when it wants
 * more — and a reader who has just stacked the diffs into one narrow column is
 * the reader most likely to want this next.
 *
 * Rehydrated here on mount, as its neighbours are, and the icon names the
 * current state rather than the action for the reason the diff-view toggle
 * beside it sets out: a diff scrolled out of sight leaves the icon as the only
 * thing still saying how it is set.
 */
export function DiffWrapToggle() {
  const wrap = useDiffWrap((s) => s.wrap);
  const toggle = useDiffWrap((s) => s.toggle);
  useEffect(() => bindDiffWrap(), []);

  const wrapping = wrap === 'on';
  const label = wrapping ? 'Stop wrapping long lines' : 'Wrap long lines';
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="lg"
      aria-label={label}
      title={label}
      onClick={toggle}
    >
      {wrapping ? <IconTextWrap size={18} /> : <IconTextWrapDisabled size={18} />}
    </ActionIcon>
  );
}
