import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

// Every file under src/web/routes/ must appear here (guardrail:
// routes-registered). Pages and resource routes share this one table; see
// docs/rr-migration/00-overview.md §4 "Routes" for the full target list.
//
// Protected pages nest under the pathless `_gated` layout, whose middleware
// enforces sign-in + allowlist. Everything outside it is public
// (phase-2-plan P2-D5).
export default [
  layout('routes/_gated.tsx', [index('routes/skeleton.tsx'), route('relink', 'routes/relink.tsx')]),
  route('login', 'routes/login.tsx'),
  route('denied', 'routes/denied.tsx'),
  route('auth/github', 'routes/auth.github.ts'),
  route('auth/github/callback', 'routes/auth.github.callback.ts'),
  route('auth/logout', 'routes/auth.logout.ts'),
  route('api/health', 'routes/health.ts'),
] satisfies RouteConfig;
