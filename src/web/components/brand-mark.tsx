/**
 * Passage product mark. Small placements use the favicon's tighter padding
 * to keep the central channel legible; larger placements use the app tile.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src={size <= 24 ? '/favicon.svg' : '/brand-mark.svg'}
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ flexShrink: 0, display: 'block' }}
    />
  );
}
