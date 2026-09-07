# Phase 0 — Baseline + legacy removal

**Goal:** a complete visual record of the app as it looks on `main`, and the
small amount of legacy that can go before any code moves. Nothing under
`src/` changes in this phase.

Parent: [00-overview.md](./00-overview.md) (D7, D13, A11).

---

## Commit 1 — baseline screenshots (nothing committed but `.gitignore`)

Screenshots live in `screenshots/baseline/` at the repo root, **gitignored**.
They are a local working artefact for the Phase 4 comparison, not a deliverable.

### Setup

- PocketBase running (`npm run pb`), superuser + GitHub provider + allowlist
  row configured (done by the maintainer).
- `.env.local` with `REVIEW_EXECUTOR=stub` so a review completes in seconds
  with no API spend.
- `npm run dev` on `http://localhost:3000`.
- Browser pane at 1280 px wide. Colour scheme toggled per capture via the
  in-app theme toggle (writes `er-theme` to localStorage and flips the
  `dark` class on `<html>`).

### Capture matrix

Every cell is captured in **dark** (the default) and **light**. File names:
`<page>--<state>--<scheme>.png`.

| Page             | States                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`         | signed out                                                                                                                                                                    |
| `/denied`        | signed out                                                                                                                                                                    |
| `/relink`        | signed in                                                                                                                                                                     |
| `/` home         | empty composer; repo picked + PR list open; PR picked (Review enabled); recent-reviews list populated; user menu open                                                         |
| `/history`       | all; filtered to `done`; filtered to an empty status (empty-filter state)                                                                                                     |
| `/jobs/:id`      | running (mid-stream, chapter titles appearing); done; cancelled; error (if one can be provoked cheaply — otherwise skip)                                                      |
| `/reviews/:id`   | top (summary card, people card, risk score); mid-chapter with insight callouts; a diff chunk expanded (Monaco); sidebar open; wide layout toggle on and off; 404 for a bad id |
| Cross-page toast | "Review ready" notification while on `/history`                                                                                                                               |

Also capture the composer's `409 job in flight` message if a second submit
is attempted during the running job (cheap, worth having).

### Procedure

1. Signed-out captures first (`/login`, `/denied`).
2. Maintainer signs in once in the browser pane (GitHub OAuth popup).
3. Home captures, then submit a stub review against a small real PR.
4. While it runs: `/jobs/:id` running capture, second-submit 409 capture.
5. After it finishes: `/jobs/:id` done, `/reviews/:id` set, `/history` set.
6. Submit another stub review and cancel it for the cancelled capture.
7. Navigate to `/history`, submit a third review from a second tab if
   needed, and capture the cross-page toast.
8. Repeat each capture in the other colour scheme (toggle, re-shoot).

Record the job ids used at the bottom of this file so Phase 4 can re-run the
same PR for the comparison.

### Commit

- `.gitignore`: add `/screenshots/`.

---

## Commit 2 — legacy removal that is safe before the rewrite

- Delete `docs/archive/migration-pocketbase.md` (and the now-empty
  `docs/archive/`).
- Remove the empty, untracked `supabase/` directory tree from the working
  copy (not a git change — just `rm -r supabase`).
- `AGENTS.md`: drop the `docs/archive/` row from the authoritative-docs
  table and the repo-layout line.
- `docs/README.md`: drop the `docs/archive/` row from the repo layout table.

Nothing else. `pb_migrations/`, `src/lib/pb/`, PB scripts and the PB
dependency are still needed to run `main` for baselines and go in Phase 1.

---

## Exit criteria

- `screenshots/baseline/` contains every cell of the matrix in both schemes.
- `npm run format:check`, `lint`, `typecheck`, `test` all green (unchanged
  from `main`).
- `git status` clean on `migrate-react-router`; two commits above `d63b87c`.

## Job ids used

- Target: `twynsicle/NightWhispers` PR #7 (`feat/dark-mode-toggle` → `main`, head `ecf6327`).
- `72hvk2n8h2acdqe` — errored (real executor ran because the `REVIEW_EXECUTOR=stub`
  env override did not beat `.env.local`; Anthropic returned "Credit balance is too
  low", so nothing was spent). Used for the **error** captures.
- `bfvj7i5bwoef917` — stub re-run, `done` in 20 s. Used for **done** + all reader captures.
- `zsf44bpzq5u8ffy` — stub run, captured mid-stream for **running (composing)**.
- `44zxs42quoqo1s3` — stub run cancelled ~3 s in. Used for the **cancelled** captures.
- `vk6zgcvhmmkd88j`, `7xxhfwsme1nidu0` — stub runs started from a second tab while
  `/history` was open; used for the **cross-page toast** captures (dark, light).
- `l8l7lm7sq1ptw7p` — stub run used for the **409 "Review already running"** composer
  message and the `/history` running-row capture.

## Findings recorded during capture

- **Pre-existing bug on `main`:** PocketBase rejects the first chunk of every job
  (`review_chunks.seq = 0` → "Cannot be blank": PB treats `0` as empty for a
  required number field). Every review is missing its `seq 0` chunk. The Prisma
  port must not inherit this; chunk `seq` starts at 0 and `0` is a valid value.
- **Stub gap:** the stub narrative has no inline diff hunks, so the Monaco
  `DiffEditor` state (inline-diff-chunk + file view with hunks) has **no
  baseline**. Capture it with a real review once Anthropic credit is available,
  before the Phase 4 comparison.
- `.env.local` `REVIEW_EXECUTOR` was flipped to `stub` for the session; restore
  to `claude` afterwards.
- **Pre-existing bug on `main`:** the home "Recent" list is always empty. `RecentReviews`
  fires two `review_jobs.getList` calls in parallel on the same PocketBase client, and
  the PB JS SDK auto-cancels the first one (same request key), so the server logs
  `[recent-reviews] fetch failed` and renders the empty state. There is therefore **no
  populated-Recent baseline**; the RR version should show the list (the `RecentRow`
  markup in `src/components/home/recent-reviews.tsx` is the design reference).
