import { beforeAll } from 'vitest';

// Integration project setup. Phase 2 replaces this hook with the Postgres
// reachability probe that marks the whole project as skipped when
// DATABASE_URL is unreachable, so `npm run check:all` degrades gracefully on
// a machine without Docker.
beforeAll(() => {
  // no-op until Phase 2
});
