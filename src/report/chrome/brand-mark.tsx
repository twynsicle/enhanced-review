import brandMarkUrl from './brand-mark.svg';

/**
 * Passage product mark. Imported rather than referenced by URL, so the
 * report, one HTML file opened from disk, gets it inlined.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={brandMarkUrl}
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ flexShrink: 0, display: 'block' }}
    />
  );
}
