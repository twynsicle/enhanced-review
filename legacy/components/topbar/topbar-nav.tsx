'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { label: 'Reviews', href: '/', match: (p: string) => p === '/' },
  { label: 'Library', href: '/history', match: (p: string) => p.startsWith('/history') },
] as const;

export function TopbarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="hidden items-center gap-1 text-[12.5px] sm:flex">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-full px-3 py-1 transition-colors',
              active
                ? 'bg-iris-soft font-semibold text-iris'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
