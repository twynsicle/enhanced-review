# enhanced-review

Web-based AI code review. Sign in with GitHub, pick one of your repositories
and a pull request or branch, and the server clones it, runs the Claude Agent
SDK against the working tree, and streams back a chaptered narrative review —
an overview, a risk assessment, chapters that group the change by theme, with
insights, diagrams of what changed, and inline diffs you can open beside the
prose.

Successor to the `diffy` Electron proof of concept, narrowed to the narrative
review and rebuilt for multiple users.

There is a second way to run it: [**local mode**](#local-mode), one command
inside the repository you are reviewing, no server and no database.

- **Operating a running deployment** — [docs/OPERATIONS.md](docs/OPERATIONS.md)
- **Working on the code** — [AGENTS.md](AGENTS.md) is the map of the tree:
  layering rules, module conventions, and the traps that only show up in the
  container. The per-area detail it points to lives in
  [.claude/rules/](.claude/rules/).
- **What is not built yet** — the `Backlog` of the Linear team
  [enhanced-reviews](https://linear.app/lemon-dev/team/ER/backlog)

## Tech stack

- **Node 24** (Volta-pinned). The Express server and the jobs CLI are
  TypeScript that Node runs directly via type stripping — no build step for
  `server/` or `src/jobs/`.
- **React Router 8** framework mode (SSR) on **Vite 8**, served by **Express 5**
  through `@react-router/express`. One process: the review runner lives
  in-process, so it must never run under a forking process manager.
- **React 19** + **Mantine 9** (theme-driven, minimal per-component CSS),
  Tabler icons, Zustand for persisted client preferences, **Zod 4** at every
  boundary.
- **Prisma 7** with `@prisma/adapter-pg` (engine-free) on **Postgres 18**.
  Polling rather than a realtime channel.
- **remix-auth 4** + GitHub OAuth, DB-backed sessions. The GitHub access token
  lives only in a signed HttpOnly cookie — it is never written to the database.
- **Pino** logging, **oxlint**, Prettier, **Vitest 4**.

## Prerequisites

| Tool   | Version | Why                                                          |
| ------ | ------- | ------------------------------------------------------------ |
| Node   | >= 24   | Type stripping runs the server and jobs CLI without a build. |
| npm    | >= 10   | Bundled with Node.                                           |
| Git    | recent  | The review runner shells out to `git` to clone the target.   |
| Docker | recent  | Runs Postgres. Also builds and runs the app as it ships.     |
| `gh`   | recent  | Local mode only: reads pull request metadata as you.         |

You also need a **GitHub OAuth app** (free) and, for real reviews, an
**Anthropic API key**. Without a key the app still works end to end against
the stub executor, which streams a canned review.

## Quick start

From a fresh clone:

```bash
docker compose up -d
```

That starts Postgres and nothing else — the app itself is behind a profile, so
it never takes `:3000` out from under `npm run dev`.

```bash
cp .env.example .env
```

Then edit `.env`:

- `SESSION_SECRET` — at least 32 characters. The file has a one-liner that
  generates one.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — from a GitHub OAuth app
  (<https://github.com/settings/developers> → **New OAuth App**). Set its
  **Authorization callback URL** to `http://localhost:3000/auth/github/callback`.
  The app requests the `repo` scope so the runner can clone private
  repositories.
- `ANTHROPIC_API_KEY` — optional. Leave `REVIEW_EXECUTOR=stub` to develop
  without one.

`DATABASE_URL` and `APP_ORIGIN` already match the compose Postgres and
`localhost:3000`. Every key is documented in `.env.example` and validated by
`src/config/env.ts` at boot, which fails with the offending key named.

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run dev
```

<http://localhost:3000> redirects to `/login`. Sign in with GitHub, pick a
repository and a PR or branch on the home page, and start a review.
`GET /api/health` reports `db: "ok"` when the database is reachable.

`npm install` also generates the Prisma client (`postinstall`), so run it
before any database command.

## Running it as it ships

```bash
docker compose --profile app up --build
```

One image, one process, on <http://localhost:3000>. `--profile app` is what
opts you in; a bare `docker compose up` leaves the port free for the dev
server. Stop it again with `docker compose --profile app down`, and note that
the image is built from your working tree at build time — `restart` re-runs the
old build, only `--build` picks up new code. The container applies
migrations and clears orphaned jobs before serving, so a fresh volume needs no
manual step. It reads `SESSION_SECRET`, the GitHub credentials and
`ANTHROPIC_API_KEY` from your `.env`.

To run a one-off job against the same image:

```bash
docker compose run --rm web node src/jobs/cli.ts recover-jobs
```

## Local mode

`er review` runs the whole review on your laptop: it gathers the change with
`git` and `gh`, runs the Claude Agent SDK as **you**, and writes one
`review.html` that renders the same reader the hosted app does. No server, no
database, no GitHub App — which is the point, because getting an app installed
in an organisation can take months.

The report is a single file: every script, style and font is inlined, so there
is nothing beside it to keep or to send. The diff editor is the exception — it
is fetched from a CDN when a diff is opened, which keeps the file small enough
to email. Reading the review needs no network; reading a diff does.

### Install

```bash
npm install
```

```bash
npm link
```

That puts `er` on your PATH, pointing at this working tree: pull a change and
it takes effect, with no rebuild. Then run it from inside **any** repository
you want reviewed, not from this one.

### Authentication is yours

`er` never reads or stores a credential. It starts the Agent SDK as a
subprocess, which inherits your environment and signs in the same way your
own `claude` does — either an `ANTHROPIC_API_KEY` in the environment, or the
session `claude` itself wrote when you signed in.

A run that ends in `Not logged in` means that session has expired, however
recently you used Claude elsewhere. Fix it where you would normally:

```bash
claude
```

Then `/login`, and run `er review` again.

### The three targets

```bash
er review
```

The current branch, against its pull request's base if one is open, and the
default branch otherwise. This is the one the hosted app cannot do: it works
before a PR exists, which is how you check work an agent wrote for you.

```bash
er review 42
```

Pull request #42, read through `gh`. The review happens in a temporary
worktree of the PR's head, so your own working tree is never touched and
never has to be clean.

```bash
er review --staged
```

What you have staged, against `HEAD` — a review before the commit.

### What it costs, and how long

The model run is the only stage that costs anything or needs the network.
Measured on this repository, an 88-file, 138-hunk change:

|           |                                         |
| --------- | --------------------------------------- |
| Turns     | 27–32                                   |
| Wall time | 5–8 minutes                             |
| Cost      | **$1.87–$2.98** of your own allowance   |
| Tokens in | ~1.1M, of which 93% was read from cache |
| Report    | 2.4 MB of HTML                          |

That is what an agentic review costs: it pays for its whole context on every
turn, so the bill tracks the number of turns more than the size of the diff.
The run line reports all of it as it finishes, cache share included.

Two ways to spend nothing while working on the tool itself:

```bash
er review --stub
```

A mechanical review with one chapter per file — no model, no cost, and the
right way to iterate on the reader.

```bash
er review --from parse
```

Re-runs only the later stages against the answer the last run already saved.
Every stage writes its input and output to the run folder, so `--from prompt`,
`run`, `parse` or `render` picks up the newest run for that target. If a
review fails to parse, its text is still on disk and this is how you rebuild
the report without paying twice.

### Where it writes

`er-reviews/<target>/<timestamp>/` inside the repository under review,
ignored by git automatically. The report is `review.html`, and it opens when
it is written unless you pass `--no-open`. Beside it sit the stage files:
`context.json` (what changed), `prompt.md` and `system.md` (what was asked),
`raw.txt` (what the model said), `events.jsonl` (what it did, what it cost,
and any command the read-only gate refused) and `review.json` (the parsed
review). A run folder is a complete record; delete the tree whenever you like.

### What the model may do

It gets `Read`, `Glob` and `Grep`, and `Bash` for read-only history —
`git log`, `git show`, `git blame`, `git diff`, and `rg`/`grep`/`ls`/`cat`
piped together. Every command is checked before it runs, and anything that
could write, or reach a program not on the list, is refused with a message
saying what it may run instead. Refusals are counted on the run line and
recorded in `events.jsonl`; a review is never failed by one.

`--model`, `--max-turns` and `--timeout` override the defaults
(`claude-sonnet-5`, 60 turns, 15 minutes). `er review --help` lists
everything.

## Scripts

| Script                            | What                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `npm run dev`                     | Express + Vite dev server on `localhost:3000`                |
| `npm run build` / `npm start`     | Production build / serve it                                  |
| `npm run typecheck`               | `react-router typegen && tsc --noEmit`                       |
| `npm test` / `npm run test:watch` | Vitest: unit + web + guardrails                              |
| `npm run test:integration`        | Vitest against a real Postgres (skips when unreachable)      |
| `npm run lint` / `format`         | oxlint / Prettier                                            |
| `npm run check`                   | **The gate**: typecheck + build + test + lint + format:check |
| `npm run check:all`               | `check` plus the integration tests                           |
| `npm run db:migrate`              | Create and apply a migration, then regenerate the client     |
| `npm run db:deploy` / `db:reset`  | Apply migrations / drop, reapply and regenerate              |
| `npm run db:studio`               | Prisma Studio                                                |
| `npm run job -- <name>`           | One-shot jobs. Currently: `recover-jobs`                     |
| `npm run viewer:dev`              | The local report's reader, against sample data               |
| `npm run viewer:build`            | The local report shell `er review` renders into              |

## How it works

### Identity and access

Signing in with GitHub is the only condition for access. The OAuth callback
upserts a `users` row keyed on the GitHub numeric id, then sets two signed
HttpOnly cookies: `er_session` (a session-row id, 7 days) and
`gh_access_token` (90 days). **The GitHub token is never persisted** — it
lives in that cookie and in memory for the duration of a job.

Root middleware resolves the session and user for every request and rolls the
session once it is past half-life. Protected pages nest under a pathless
layout whose middleware requires a signed-in user; anyone else has their
session destroyed, both cookies cleared, and is redirected to `/login`.

There is no allowlist. Every signed-in user can see every other user's
reviews, and only the owner can cancel one. **Whatever fronts the deployment
is the access control** — see
[Access control](docs/OPERATIONS.md#access-control).

### A review, end to end

1. **Create.** The composer posts a target (repo + PR or branch). The server
   refuses if the user is already at `MAX_JOBS_PER_USER` jobs in flight,
   re-resolves the target's commit SHAs against GitHub with the caller's
   token, inserts a `pending` row, and launches the job fire-and-forget with
   an `AbortController` and a `REVIEW_TIMEOUT_MIN` timer.
2. **Run.** `pending → running`, fetch PR metadata, shallow-fetch the head ref
   into a temporary clone, verify the head SHA has not moved, fetch the base
   SHA, diff, filter the changed files, and hand the result to the executor.
3. **Stream.** The executor emits raw text; each fragment becomes a
   `review_chunks` row. The live view polls `/api/jobs/:id?after=<seq>` and
   renders a timeline as they arrive.
4. **Finish.** The parsed narrative and `running → done` are written in one
   transaction, so anything that observes `done` already sees the whole
   stream. Failures write `error` with a clipped message; cancellation and
   timeout each write their terminal status before signalling the runner.
5. **Read.** `/reviews/:id` renders the stored narrative — a summary led by
   an overview diagram, a risk section, then the chapters — and fetches
   view-time context from GitHub (PR header, reviewers, whether the head has
   moved since the review). Every section degrades on its own; with no token,
   nothing is fetched and the stored review still renders.

Jobs run in-process, so a row left `pending` or `running` by a stopped process
can never finish. The server clears those at boot, and
`npm run job -- recover-jobs` does the same on demand.

### Diagrams

The model may attach a diagram to the review and to any chapter: an
architecture map, a state machine, a before/after of one procedure, or a
sequence. It does not write mermaid. It writes a small JSON schema
(`src/domain/review/diagram.ts`) in which every node and edge says what the
pull request did to it — added, removed, modified or unchanged — because a
review diagram describes a change, not a system. A code node can point at a
file and hunks from the diff, and the parser drops any path or hunk the diff
does not contain, so a diagram can only link to code that is really there.
An invalid diagram is dropped on its own and never fails the review.

The reader lays diagrams out with dagre and draws them as SVG on the server,
in the design system's tokens and type scale. They render at full size and
scroll sideways rather than shrinking text, and every diagram opens in a
full-screen view with pan and zoom.

### Executors

`REVIEW_EXECUTOR=stub` replays a canned review in fragments — the local
default, and what every test uses. `claude` runs the Claude Agent SDK inside
the clone with read-only tools, the filesystem sandbox pinned to the clone,
`settingSources: []` so the reviewed repository's own `.claude/` cannot
register hooks, no session persistence, and only an explicit allowlist of
environment variables.

### Scope

Deliberate cuts, unchanged from the proof of concept: narrative review only
(no staged/unstaged workspace browser), manual triggers only (no webhooks),
and reviews live in this app with no write-back to the GitHub pull request.

## Repo layout

| Path              | What                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `server/`         | Express bootstrap, dev/prod switch, signal handling               |
| `src/config/`     | Zod-parsed environment — the only reader of `process.env`         |
| `src/common/`     | Logger and small shared helpers                                   |
| `src/db/`         | Prisma client and one repository module per table                 |
| `src/domain/`     | Auth, GitHub, jobs and the review runner. Shared with the browser |
| `src/web/`        | The React Router app: routes, components, theme, auth wiring      |
| `src/jobs/`       | The one-shot jobs CLI                                             |
| `src/cli/`        | `er`, the local review CLI, and its stages                        |
| `src/guardrails/` | Tests that read the repo and enforce its conventions              |
| `prisma/`         | Schema and migrations                                             |

`AGENTS.md` has the tree, the layering rules the guardrails enforce, and the
`*.server.ts` convention that keeps server-only code out of the browser
bundle; `.claude/rules/` holds the file-by-file detail for each area.

## Testing

`npm run check` is the gate and needs no `.env` — the Vitest config supplies
placeholders for the required keys and forces the stub executor, so a check
never calls the Anthropic API. `npm run check:all` adds the integration
tests, which need a running Postgres and skip themselves when they cannot
reach one.

Integration tests truncate the tables they use, so point them at a scratch
database rather than one holding a session you care about.

## Known gaps

- **The `claude` executor has only been exercised on the host**, against
  this repository's own pull requests, and never in the container. Tests stop
  at the executor boundary and use the stub, so the SDK call itself is
  covered by nothing automated.
- There is no retention policy. Chunks, jobs and reviews accumulate. See
  [Retention](docs/OPERATIONS.md#retention).
- **Local mode is Windows-only so far.** Everything OS-specific is behind
  `src/cli/platform.ts`, but nothing has been run on macOS, which the
  organisation uses. That is its own piece of work.
- Local mode's model run is not covered by automated tests either, for the
  same reason as the hosted executor: the tests stop at the SDK boundary.
