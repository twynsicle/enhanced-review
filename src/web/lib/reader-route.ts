import { useMatches } from 'react-router';

/**
 * What the reader route puts on its `handle`, so the topbar can tell that the
 * page beneath it is the reader.
 *
 * The topbar renders in the shell layout, above the outlet, so the page cannot
 * pass it anything — and two things hang off the answer. The header has to take
 * the same width as the page it sits over, and the reader's display
 * preferences (page width, split or unified diffs) should only be offered where
 * they do something: on a composer or a history list they are a control that
 * visibly does nothing.
 *
 * A route with no handle is an ordinary fixed-width page, which is the right
 * default — a new page has to ask for the reader's treatment.
 */
export const READER_HANDLE = { reader: true } as const;

/** True on the reader route, false on every other page inside the shell. */
export function useIsReader(): boolean {
  return useMatches().some(
    (match) => (match.handle as { reader?: boolean } | undefined)?.reader === true,
  );
}
