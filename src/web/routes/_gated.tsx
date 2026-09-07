import { Outlet } from 'react-router';
import { allowlistGate } from '@/web/auth/gate-middleware.server';
import type { Route } from './+types/_gated';

/**
 * Pathless layout for every protected page. The gate runs before any child
 * loader/action; children must export a loader so the middleware chain runs
 * for their document requests (phase-2-plan P2-D5).
 */
export const middleware: Route.MiddlewareFunction[] = [allowlistGate];

export default function Gated() {
  return <Outlet />;
}
