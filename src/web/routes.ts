import { index, route, type RouteConfig } from '@react-router/dev/routes';

// Every file under src/web/routes/ must appear here (guardrail:
// routes-registered). Pages and resource routes share this one table; see
// docs/rr-migration/00-overview.md §4 "Routes" for the full target list.
export default [
  index('routes/skeleton.tsx'),
  route('api/health', 'routes/health.ts'),
] satisfies RouteConfig;
