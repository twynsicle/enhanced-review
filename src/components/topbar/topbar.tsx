import Link from 'next/link';
import { BrandMark } from '@/components/topbar/brand-mark';
import { LayoutWidthToggle } from '@/components/theme/layout-width-toggle';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { TopbarNav } from '@/components/topbar/topbar-nav';
import { UserMenu, type TopbarUser } from '@/components/topbar/user-menu';

export function Topbar({ user }: { user: TopbarUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-[var(--review-max-width,92rem)] items-center justify-between gap-6 px-5 sm:px-7">
        <div className="flex items-center gap-7">
          <Link
            href="/"
            className="group inline-flex items-center gap-2.5"
            aria-label="Enhanced Review — home"
          >
            <BrandMark size={48} className="transition-transform group-hover:-rotate-3" />
            <span className="font-serif text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              Enhanced&nbsp;Review
            </span>
          </Link>
          <TopbarNav />
        </div>
        <div className="flex items-center gap-1.5">
          <LayoutWidthToggle />
          <ThemeToggle />
          {user ? <UserMenu user={user} /> : null}
        </div>
      </div>
    </header>
  );
}
