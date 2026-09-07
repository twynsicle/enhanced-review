import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Product mark — two-pane review icon. Sourced from the brand asset
 * at `public/brand-mark.png` so it stays pixel-identical to the icon
 * used elsewhere; Next/Image handles responsive sizing + optimisation.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand-mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      priority
      className={cn('shrink-0', className)}
    />
  );
}
