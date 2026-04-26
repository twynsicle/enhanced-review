'use client';

import { Bell, Clock, LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/hooks/use-toast';
import { pbBrowser } from '@/lib/pb/browser';

export interface TopbarUser {
  login: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export function UserMenu({ user }: { user: TopbarUser }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'unsupported',
  );

  useEffect(() => {
    // Read the browser-API permission state once after mount. We can't
    // read it during render (would mismatch SSR) and the value isn't
    // reactive enough to justify a useSyncExternalStore subscription.
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotifPermission(Notification.permission);
  }, []);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    // Belt: clear PB auth state (localStorage + pb_auth cookie via
    // pbBrowser's onChange). Suspenders: hit the server endpoint to clear
    // the HttpOnly gh_access_token cookie that the browser can't touch.
    pbBrowser().authStore.clear();
    await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {
      /* swallowed: best-effort */
    });
    router.replace('/login');
  }, [router]);

  const enableNotifs = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === 'granted') {
        toast({
          title: 'Notifications enabled',
          description: "You'll get a system notification when a review finishes.",
          variant: 'success',
        });
      } else if (result === 'denied') {
        toast({
          title: 'Notifications blocked',
          description: 'Re-enable from your browser settings if you change your mind.',
          variant: 'destructive',
        });
      }
    } catch {
      /* swallowed: some browsers throw outside a user gesture */
    }
  }, []);

  const showEnableNotifs = notifPermission === 'default';
  const initials = (user.fullName ?? user.login).slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 inline-flex size-8 items-center justify-center overflow-hidden rounded-full ring-1 ring-foreground/15 transition-all hover:ring-foreground/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:ring-foreground/40"
        aria-label="Open user menu"
      >
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt=""
            width={32}
            height={32}
            className="size-full object-cover"
          />
        ) : (
          <span className="text-[10px] font-semibold text-muted-foreground">{initials}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-2">
          <span className="truncate text-sm font-medium text-foreground">
            {user.fullName ?? user.login}
          </span>
          <span className="truncate text-xs text-muted-foreground">@{user.login}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/history">
            <Clock className="size-4" />
            <span>Review history</span>
          </Link>
        </DropdownMenuItem>
        {showEnableNotifs && (
          <DropdownMenuItem onSelect={enableNotifs}>
            <Bell className="size-4" />
            <span>Enable notifications</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(e) => {
            e.preventDefault();
            void signOut();
          }}
          disabled={signingOut}
        >
          <LogOut className="size-4" />
          <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
