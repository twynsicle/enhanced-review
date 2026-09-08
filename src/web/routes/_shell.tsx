import { Outlet } from 'react-router';
import { env } from '@/config/env';
import { userContext } from '@/web/auth/context.server';
import { Topbar } from '@/web/components/topbar/topbar';
import type { Route } from './+types/_shell';

/**
 * App shell for every page with chrome (phase-4-plan P4-D5): the topbar now,
 * the cross-page job notifier from commit 6. Nested inside `_gated`, so the
 * user is always present; `serverNow` seeds the notifier's `since` and the
 * polling intervals come from the environment (P4-D9).
 */
export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(userContext);
  return {
    user: user ? { login: user.githubLogin, fullName: user.name, avatarUrl: user.avatarUrl } : null,
    serverNow: new Date().toISOString(),
    polling: { liveMs: env.LIVE_POLL_MS, terminalMs: env.TERMINAL_POLL_MS },
  };
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <Topbar user={loaderData.user} />
      <Outlet />
    </>
  );
}
