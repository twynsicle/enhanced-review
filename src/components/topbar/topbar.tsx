import Link from 'next/link';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { UserMenu, type TopbarUser } from '@/components/topbar/user-menu';

export function Topbar({ user }: { user: TopbarUser | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span
            aria-hidden
            className="inline-flex size-6 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background ring-1 ring-foreground/20 transition-transform group-hover:-rotate-6"
          >
            er
          </span>
          <span>enhanced-review</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/history"
            className="hidden rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
          >
            History
          </Link>
          <ThemeToggle />
          {user ? <UserMenu user={user} /> : null}
        </div>
      </div>
    </header>
  );
}
