# Phase 4 — Worker: real repo + real opencode

## Goal

Replace the Phase 3 stub worker with the real thing: shallow-clone the repo using the user's GitHub OAuth token, invoke `opencode` with the right prompt and a permission-locked `opencode.json`, parse its output into the POC's narrative shape, and persist. Cancellation kills the subprocess.

## Demoable at end

- Clicking Review on a real PR produces a real AI review (current opencode-zen GLM model by default), structured as chapters + insights + inline diff chunks.
- The review row is persisted; `/history` shows it as `done`.
- Cancelling mid-flight kills the opencode subprocess within ~1s.
- A failed clone or failed opencode run sets `status='error'` with a useful `error_message`.
- The clone directory is deleted after the job ends (success, error, or cancel).
- When the diff was truncated to fit the token budget, the persisted review flags it so Phase 6's reader UI can surface a banner.

## Decisions (resolved during planning)

| Topic                  | Decision                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Executor               | `opencode` CLI, behind a `ReviewExecutor` interface so a Claude-Code SDK swap is one new file. |
| Token plumbing         | `POST /api/jobs` captures the user's `provider_token` and stores it on the `review_jobs` row.  |
| Token at rest          | pgsodium symmetric encryption on a new `github_token_encrypted` column.                        |
| Token lifecycle        | Worker NULLs the column immediately after a successful clone (token unneeded after that).      |
| File filter            | `AGENTS.md` instruction file in the clone + diff patches for excluded paths stripped pre-prompt. |
| Hunk catalog           | Port `diff-hunk-catalog.ts`, `narrative-prompt.ts`, `parseNarrativeReview` as-is from the POC. |
| Agent tool posture     | Read-only via opencode.json permission rules (allow read/grep/list, deny write/bash). No `--dangerously-skip-permissions`. |
| opencode-zen API key   | `OPENCODE_ZEN_API_KEY` env var, referenced from a worker-generated `opencode.json` via `{env:…}`. |
| Model id               | `REVIEW_MODEL` env var, default = current opencode-zen GLM. Logged on each job.                |
| Cancellation           | `LISTEN review_jobs_cancel` (new channel fired by an UPDATE trigger). SIGTERM the child immediately, SIGKILL after a brief grace. |
| Diff truncation UX     | New `diff_truncated boolean default false` column on `reviews`. Reader UI banner in Phase 6.   |
| Base image             | `node:20-bookworm-slim` (glibc) — better fit for opencode's prebuilt binary and git's helpers. |
| Worker concurrency     | Still one job per worker (Phase 7 introduces parallelism).                                     |

## Tasks

1. **DB migration `0003_phase4.sql`** — additive, idempotent:
   - `alter table public.review_jobs add column github_token_encrypted bytea`.
   - Enable pgsodium, provision a named AEAD-det key (`review_jobs_github_token`).
   - SECURITY DEFINER helper functions `public.encrypt_github_token`, `public.decrypt_github_token`, plus the atomic `public.create_review_job_with_token` and `public.decrypt_review_job_token` RPCs that the API and worker call. Granted to `service_role` only.
   - `alter table public.reviews add column diff_truncated boolean not null default false`.
   - `create or replace function public.review_jobs_notify_cancel()` that `pg_notify('review_jobs_cancel', new.id::text)` on the pending|running → cancelled transition, plus the AFTER UPDATE trigger that fires it.
   - **Migration runner**: `scripts/db-migrate.sh` is updated to invoke `psql -U supabase_admin` (not `postgres`). pgsodium privileges are gated to `supabase_admin` in the vendored Supabase image, so SECURITY DEFINER functions need that role as their owner. This matches the role the upstream Supabase image's own bootstrap migrations use.
   - Key-management notes live inline in the migration's header comment.

2. **`POST /api/jobs` change** — alongside the existing insert, encrypt the caller's `provider_token` with pgsodium and write it to `github_token_encrypted`. Service-role insert is already in place, so this is one extra column. Surface a clear error if `provider_token` is missing (token relink flow).

3. **Worker Docker image** — switch to `node:20-bookworm-slim`. Install `git`, `opencode` CLI (pinned version), and tini. Document upgrade procedure in the Dockerfile header.

4. **opencode.json generator** — at worker startup or per-job, write an `opencode.json` into the clone dir (or a worker-controlled config dir) containing:
   - Provider config that maps the chosen model id to opencode-zen, with `apiKey: "{env:OPENCODE_ZEN_API_KEY}"`.
   - `permission.rules` that allow read on `**/*`, deny write on `**`, deny bash on `*`. Add explicit read-deny patterns for the `ai-file-filter` excluded globs (`**/package-lock.json`, `**/__snapshots__/**`, etc.) as a hard backstop.

5. **Per-job working directory** — `os.tmpdir()/review-{job_id}/`. Create on job start; `rm -rf` in a `finally` block.

6. **Token usage** for the job:
   - Read `github_token_encrypted` from the row using service role + pgsodium decrypt.
   - Construct the clone URL as `https://x-access-token:${TOKEN}@github.com/${owner}/${repo}.git`.
   - **Never log the token.**
   - After the clone returns, immediately UPDATE the row to NULL the column.

7. **Shallow clone**:
   - PR target: `git clone --depth=1 --branch <head_ref> <url>`, then `git fetch --depth=1 origin <base_sha>` to make `git diff base..head` work.
   - Branch target: `git clone --depth=1 --branch <ref> <url>`, then `git fetch --depth=1 origin <default_branch>` for the diff base.
   - Verify the actual cloned HEAD SHA matches `review_jobs.head_sha`. If the PR has moved since job creation, mark the job as error and tell the user to retry.

8. **Compute the diff** — `git diff <base_sha>..<head_sha>` saved to a file in the working dir.

9. **Apply file filter** — port `ai-file-filter.ts` from the POC. Same module powers (a) stripping excluded patches from the diff text in the prompt, (b) the `read.deny` glob list in opencode.json (hard backstop), and (c) the advisory list in AGENTS.md. `builtInDenyGlobs()` produces the rooted-glob form for the config.

10. **Generate AGENTS.md in the clone** — short instruction file telling the agent to ignore the excluded globs and to focus on the supplied diff. Advisory only; the opencode.json read-deny rules are the hard enforcement.

11. **Build the opencode prompt** — port `narrative-prompt.ts` + `diff-hunk-catalog.ts` from the POC, adapted:
    - System prompt instructs opencode to produce structured JSON wrapped in `<narrative_review>` tags (matches POC parser).
    - User prompt includes the diff (truncated at the same 80k token budget) + PR/branch metadata + the hunk catalog (H0001…) so the model emits resolvable hunk IDs.
    - Set `wasTruncated = true` on the persisted review when the truncator fired.

12. **Invoke opencode** — `child_process.spawn('opencode', ['run', '--model', model], { cwd: cloneDir, env: { ...process.env, OPENCODE_ZEN_API_KEY }, stdio: ['pipe','pipe','pipe'] })`. Pipe the user prompt to stdin; the system prompt rides in via AGENTS.md inside the cloneDir. Buffer all stdout; Phase 5 handles incremental streaming. We deliberately skip `--format json` because opencode-zen's CLI envelope only wraps free-form text, and the `<narrative_review>` tags already give us a robust slice point.

13. **Parse output** — run the POC's `<narrative_review>` tag parser + tolerant normaliser directly on opencode's stdout. On parse failure raise `ExecutorParseError` with the raw text preserved; on a non-zero exit raise `ExecutorProcessError`. Both are flattened into a short `error_message` prefix by `runOpencodeJob`.

14. **Persist** — insert into `reviews` with `content = parsedReview, diff_truncated = wasTruncated`; update `review_jobs` to `status='done'`, `completed_at=now()`.

15. **Cancellation** — `LISTEN review_jobs_cancel` on the worker's pg connection. On a notification matching the running job id, `SIGTERM` the opencode child, wait ~2s, then `SIGKILL`. Clean up the clone dir.

16. **Error handling** — distinguish: clone failure (network / auth), opencode timeout, opencode non-zero exit, parse failure. Each gets a different `error_message` prefix. All of them clean up the clone dir and NULL the token column.

## Modularity for future Claude-Code-SDK swap

Define a worker-internal interface:

```ts
type ReviewExecutor = {
  name: 'opencode' | 'claude-code';
  run(input: {
    cloneDir: string;
    diff: string;
    metadata: TargetMetadata;
    signal: AbortSignal;
  }): Promise<{ review: NarrativeReview; wasTruncated: boolean }>;
};
```

Phase 4 implements only the opencode executor. The worker entry point picks an executor by env var (`REVIEW_EXECUTOR=opencode`, default). Adding the Claude-Code-SDK executor later is a single new file, no changes to the queue / DB / API layers.

## Out of scope (deferred)

- Token-by-token streaming to the frontend (Phase 5 — Phase 4 only stores the final review).
- Repo cache reuse / persistent clones — every job clones fresh per the original decision.
- Multiple repos in flight on one worker — assume one job at a time per worker; concurrency comes in Phase 7.
- Reader-UI banner for `diff_truncated`. Worker only persists the flag; UI lives in Phase 6.
