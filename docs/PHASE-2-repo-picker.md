# Phase 2 — Repo & target picker

## Goal

Use the signed-in user's GitHub OAuth token to let them browse their repos and pick a PR or branch to review. Capture the selection in the URL on a dedicated `/picker` route and surface a "Review" button — which is a no-op for now (Phase 3 wires it up).

## Demoable at end

- After sign-in, the user clicks through to `/picker` and sees a list of their accessible repos, sorted by most-recently pushed, with a name filter.
- Clicking a repo navigates to `/picker/[owner]/[repo]` showing two tabs: **Open PRs** and **Branches**.
- The PRs tab lists open PRs with title, number, head ref, and author.
- The branches tab lists branches **active in the last 30 days only**, sorted by latest commit date, with a search bar that filters within that window.
- Selecting a PR or branch updates the URL (`?target=pr:123` or `?target=branch:my-feature`) and enables a "Review" button. Clicking it currently does nothing.
- If GitHub returns 401 (token revoked / expired), the user is sent to a "Re-link your GitHub account" page that re-runs the OAuth flow.

## Tasks

1. **Workspace restructure** — turn `enhanced-review/` into an npm workspaces root. The Next.js app stays where it is (own `package.json`), and a sibling `packages/github-client/` is added. Phase 4's worker will depend on the same package.
2. **GitHub API client package** (`packages/github-client/`) — Octokit-based client exposing both REST and GraphQL helpers. Token is always passed in as an argument; **no Next.js / cookies / request-context coupling** so the worker can reuse it verbatim.
3. **Token retrieval helper** (web app) — server-side function that reads the GitHub `provider_token` from the Supabase session via `@supabase/ssr`.
4. **OAuth scope upgrade + re-link flow** —
   - Update `signInWithOAuth` to request scope `repo`.
   - Existing Phase 1 sessions don't have this scope; document that they need to sign out + back in once.
   - Build a `/relink` page that triggers `signInWithOAuth` again with the same scope.
   - On any GitHub 401, server code returns a `401 + { reason: 'github_token_invalid' }` response; the client redirects to `/relink`. We do **not** attempt token refresh — GitHub OAuth Apps don't issue refresh tokens by default and Supabase doesn't proactively re-mint `provider_token`. Calling `supabase.auth.refreshSession()` would only refresh the Supabase JWT, not the provider token.
5. **Repos endpoint** — Next.js Route Handler `GET /api/github/repos` returns the first 100 accessible repos via `GET /user/repos` with `affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100`. No server-side caching for v1; route handler uses `force-dynamic` / `no-store`.
6. **PRs endpoint** — `GET /api/github/repos/:owner/:repo/pulls` returns the first 100 open PRs (REST `pulls` with `state=open&per_page=100`).
7. **Branches endpoint** — `GET /api/github/repos/:owner/:repo/branches` runs a GraphQL query against `Repository.refs(refPrefix: "refs/heads/", orderBy: { field: COMMITTED_DATE, direction: DESC }, first: 100)`, then filters server-side to refs whose tip commit is within the last 30 days. Returns `{ ref, headSha, headCommitDate, headCommitMessage }[]`.
8. **UI: repo list page** at `/picker` — name filter, "showing first 100" notice when 100 are returned, empty state for zero repos.
9. **UI: repo detail page** at `/picker/[owner]/[repo]` — PRs / Branches tabs. Each tab has its own client-side search box that filters within the current set. Branches tab additionally shows "Showing branches active in the last 30 days" copy.
10. **Selected-target state** — encoded as a URL query param on the detail page: `?target=pr:<number>` or `?target=branch:<ref>`. The detail page resolves the rest of `ReviewTarget` (head SHA, base ref, title, etc.) on selection and shows a sticky "Review" footer with the resolved target. No DB persistence yet.
11. **Review button** — enabled when a target is selected, pure no-op on click. Phase 3 replaces the handler.
12. **Empty / error states** — no repos, no open PRs, no branches in last 30 days, GitHub rate-limited (forward GitHub's `x-ratelimit-reset` to the user), token invalid (→ `/relink`).
13. **Unit tests (Vitest)** — cover the github-client package: REST factory, GraphQL factory, the 30-day filter, and the 401 detection path (mocked fetch). No route-handler integration tests required.

## Data shape

A "review target" is one of:

```ts
type ReviewTarget =
  | {
      kind: 'pr';
      owner: string;
      repo: string;
      number: number;
      headSha: string;
      baseSha: string;
      title: string;
    }
  | {
      kind: 'branch';
      owner: string;
      repo: string;
      ref: string;
      headSha: string;
      baseRef: string;
      baseSha: string;
    };
```

The base ref for a branch target = the repo's default branch (resolved at selection time).

URL encoding on the detail page: `?target=pr:<number>` or `?target=branch:<ref>`. The remaining fields are looked up against the current PR / branch list when the page renders the selection footer.

## Out of scope (deferred)

- Persisting the target — happens in Phase 3 when "Review" creates a `review_jobs` row.
- Caching repo/PR/branch lists in Postgres — pure pass-through to GitHub API for now.
- Pagination UI — first 100 only across all lists; revisited if it bites in beta.
- Recently-used repos / favourites — adds DB state; defer.
- Escape hatch for branches older than 30 days — none. If a user's target branch is stale, they get a fresh commit on it or wait for a future phase to add a "show all" toggle.
- Server-side HTTP caching of GitHub responses (Next.js fetch cache) — defer to Phase 7 polish.

## Decisions (resolved)

- **OAuth scope**: `repo` (full read/write to public + private). Read-only on our side, but `repo` is GitHub's coarsest scope and the closed beta needs private repo access. Existing Phase 1 sessions must re-authenticate.
- **Pagination**: First 100 only across all lists. No paged or infinite-scroll UI in v1.
- **Repo list ordering**: `sort=pushed`, flat list, client-side name filter. No grouping by owner.
- **Selected-target state**: URL query params on a dedicated `/picker/[owner]/[repo]` route. Shareable, deep-linkable, survives refresh, no extra state library.
- **App shell**: `/picker` is the picker root; `/` stays the placeholder home page from Phase 1 with a "Browse repos →" link, reserved for the eventual dashboard.
- **Token refresh**: none. 401 from GitHub → `/relink` flow. Documented because the original phase doc incorrectly suggested `supabase.auth.refreshSession()` would help.
- **Branches**: hard 30-day filter, no escape hatch. GitHub's `/branches` REST endpoint is alphabetical-only, so we use GraphQL `Repository.refs` ordered by committed date.
- **Client reuse**: npm workspaces with `packages/github-client/` from day one, so Phase 4's worker imports the same package without rework. `enhanced-review/` stays as the Next.js app root; restructuring is additive.
- **Tests**: unit tests required for the github-client package. Route handlers stay test-optional.
- **Review button behaviour**: pure no-op for Phase 2.

## Risks

- **Re-auth required for the seed user.** Anyone who signed in during Phase 1 has a session without the `repo` scope; they must sign out and back in once. Document this.
- **GraphQL token scope.** GraphQL needs the same `repo` scope; verify the `provider_token` works for both REST and GraphQL with no surprises.
- **Rate limits.** Authenticated users get 5000 req/hr. Each detail-page visit costs ~3 calls (PRs + branches GraphQL + default-branch lookup). Should be fine but worth noting if a beta user hammers the picker.
- **30-day branch filter is opinionated.** A user with a 35-day-old feature branch can't reach it. Acceptable for the operator's main repo (where the filter is the whole point) but may surprise other beta users — add the "show all" toggle later if it bites.
