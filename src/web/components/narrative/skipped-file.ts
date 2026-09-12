import type { ReviewFileSkipReason } from '@/domain/review/narrative';

/** Why a changed file was not reviewed, short enough for a tooltip. */
export const SKIP_REASON_LABEL: Record<ReviewFileSkipReason, string> = {
  generated: 'generated',
  vendored: 'vendored',
  'built-in': 'lockfile, bundle or snapshot',
  binary: 'binary',
};

/** The same, as the file view's explanation. */
export const SKIP_REASON_TEXT: Record<ReviewFileSkipReason, string> = {
  generated:
    'This file is marked linguist-generated in .gitattributes, so it was left out of the review.',
  vendored:
    'This file is marked linguist-vendored in .gitattributes, so it was left out of the review.',
  'built-in':
    'Lockfiles, minified bundles, source maps and snapshots are left out of every review.',
  binary: 'This is a binary file, so there is no text diff to review.',
};
