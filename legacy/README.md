# legacy/ — read-only porting reference

Source from the Next.js + PocketBase app (`main` at `d63b87c`) that Phases 2–4
of the React Router migration port into `src/`. Nothing here compiles, lints,
formats or runs: the directory is excluded from `tsconfig.json`, ESLint,
Prettier and Vitest, and its imports (`next/*`, `pocketbase`, `@/components/ui`,
Tailwind classes) no longer resolve.

| Folder / file                  | Ported in | Becomes                                              |
| ------------------------------ | --------- | ---------------------------------------------------- |
| `lib/pb/`, `proxy.ts`          | Phase 2   | remix-auth session + allowlist middleware semantics  |
| `lib/auth/`                    | Phase 2   | `src/domain/auth/`                                   |
| `lib/github/`, `packages/github-client/` | Phase 3 | `src/domain/github/`                          |
| `lib/jobs/`, `packages/review-types/` | Phase 3 | `src/domain/jobs/`, `src/domain/review/`        |
| `lib/narrative/`               | Phase 3   | `src/domain/review/`                                 |
| `app/` (pages + API routes)    | Phase 4   | `src/web/routes/` loaders, actions, resource routes  |
| `components/`                  | Phase 4   | `src/web/components/` on Mantine                     |
| `globals.css`                  | Phase 1   | `src/web/theme/` (Editorial Iris tokens)             |

Delete this directory at the end of Phase 4 (see
`docs/rr-migration/00-overview.md`, decision P1-D1 in `phase-1-plan.md`).
