import brandMarkUrl from './brand-mark.svg';

/**
 * Passage product mark. Small placements use the favicon's tighter padding
 * to keep the central channel legible; larger placements use the app tile.
 * The tile is imported rather than served from `public/`, so the local report
 * (one HTML file, no server) gets it inlined; the favicon has to stay at its
 * fixed public path for `<link rel="icon">`, so the report uses only sizes
 * above 24.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={size <= 24 ? '/favicon.svg' : brandMarkUrl}
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ flexShrink: 0, display: 'block' }}
    />
  );
}
