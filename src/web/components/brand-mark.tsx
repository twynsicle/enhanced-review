/**
 * Product mark — two-pane review icon from `public/brand-mark.png`, kept as
 * the raw asset so it stays pixel-identical to the favicon.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/brand-mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      style={{ flexShrink: 0, display: 'block' }}
    />
  );
}
