import { index, layout, route, type RouteConfig } from '@react-router/dev/routes';

// Every file under src/web/routes/ must appear here (guardrail:
// routes-registered). Pages and resource routes share this one table.
//
// Protected routes nest under the pathless `_gated` layout, whose middleware
// requires a signed-in user. Pages with chrome nest one level deeper under
// `_shell`; `/relink` and the resource routes are gated but chrome-less.
// Everything outside is public.
export default [
  layout('routes/_gated.tsx', [
    layout('routes/_shell.tsx', [
      index('routes/home.tsx'),
      route('history', 'routes/history.tsx'),
      route('schedules', 'routes/schedules.tsx'),
      route('jobs/:id', 'routes/jobs.$id.tsx'),
      route('reviews/:id', 'routes/reviews.$id.tsx'),
    ]),
    route('relink', 'routes/relink.tsx'),
    route('api/github/repos', 'routes/api.github.repos.ts'),
    route('api/github/repos/:owner/:repo/pulls', 'routes/api.github.pulls.ts'),
    route('api/github/repos/:owner/:repo/branches', 'routes/api.github.branches.ts'),
    route('api/github/file', 'routes/api.github.file.ts'),
    route('api/me/jobs/terminal', 'routes/api.me.jobs.terminal.ts'),
    route('api/jobs/:id', 'routes/api.jobs.$id.ts'),
  ]),
  route('login', 'routes/login.tsx'),
  route('auth/github', 'routes/auth.github.ts'),
  route('auth/github/callback', 'routes/auth.github.callback.ts'),
  route('auth/logout', 'routes/auth.logout.ts'),
  route('api/health', 'routes/health.ts'),
] satisfies RouteConfig;
