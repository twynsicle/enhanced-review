# Phase 2 — Repo & target picker

## Goal

Use the signed-in user's GitHub OAuth token to let them browse their repos and pick a PR or branch to review. Capture the selection in app state and surface a "Review" button — which does nothing yet (Phase 3 wires it up).

## Demoable at end

- After sign-in, the user sees a list of their accessible repos (sortable / filterable).
- Clicking a repo shows two tabs: **Open PRs** and **Branches**.
- The PRs tab lists open PRs with title, number, head ref, and author.
- The branches tab lists branches with the latest-commit SHA + message.
- Selecting a PR or branch enables a "Review" button. Clicking it currently no-ops (or shows a toast saying "Phase 3 will hook this up").
- Token refresh works — leaving the tab open past token expiry and clicking around still works without forcing a re-login.

## Tasks

1. **GitHub API client** — Octokit (REST) instance constructed per request from the user's session token. Centralize so Phase 4 can reuse it from the worker.
2. **Token retrieval helper** — server-side function that fetches the latest GitHub provider token from the Supabase session (Supabase Auth stores `provider_token` and `provider_refresh_token` on the session).
3. **Token refresh** — if a GitHub call returns 401, attempt refresh via Supabase Auth's `refreshSession`. Bubble up a "please re-link GitHub" error if refresh fails.
4. **Repos endpoint** — Next.js Route Handler `GET /api/github/repos` that returns the user's accessible repos (paginated).
5. **PRs endpoint** — `GET /api/github/repos/:owner/:repo/pulls` returns open PRs.
6. **Branches endpoint** — `GET /api/github/repos/:owner/:repo/branches` returns branches with latest-commit info.
7. **UI: repo list page** with search/filter on name.
8. **UI: repo detail page** with PRs / branches tabs.
9. **Selected-target state** — keep this in client state (URL params or a query-param-backed store). No DB persistence yet; the next phase persists it as a `review_jobs` row when the user actually clicks Review.
10. **Empty / error states** — no repos, no open PRs, GitHub rate-limited, token expired.

## Data shape

A "review target" is one of:

```ts
type ReviewTarget =
  | { kind: 'pr'; owner: string; repo: string; number: number; headSha: string; baseSha: string; title: string }
  | { kind: 'branch'; owner: string; repo: string; ref: string; headSha: string; baseRef: string; baseSha: string };
```

The base ref for a branch target = the repo's default branch (resolved at selection time).

## Out of scope (deferred)

- Persisting the target — happens in Phase 3 when "Review" creates a `review_jobs` row.
- Caching repo/PR lists in Postgres — pure pass-through to GitHub API for now.
- Repo browsing for repos the user *doesn't* own (e.g., orgs they collaborate on) — should "just work" via OAuth scopes, but we'll verify here.

## Open questions to resolve before planning

- **OAuth scopes** — `repo` (private repo access) vs `public_repo` (public only). For closed beta we likely want `repo` so internal/private repos are reviewable. Confirm.
- **Pagination** — infinite scroll vs paged. Infinite scroll is more polished but more work. Probably paged for v1.
- **"Recently used" repos** — nice UX, but adds DB state. Defer to a later phase.
