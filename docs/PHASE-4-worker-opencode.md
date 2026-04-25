# Phase 4 — Worker: real repo + real opencode

## Goal

Replace the Phase 3 stub worker with the real thing: shallow-clone the repo using the user's GitHub OAuth token, apply the file filter, invoke `opencode` with the right prompt, parse its output into the POC's narrative shape, and persist. Cancellation kills the subprocess.

## Demoable at end

- Clicking Review on a real PR produces a real AI review by GLM 5.1 via opencode-zen, structured as chapters + insights + inline diff chunks.
- The review row is persisted; `/history` shows it as `done`.
- Cancelling mid-flight kills the opencode subprocess within a few seconds.
- A failed clone or failed opencode run sets `status='error'` with a useful `error_message`.
- The clone directory is deleted after the job ends (success, error, or cancel).

## Tasks

1. **Worker Docker image** — install `git`, `opencode` CLI, and any dependencies. Pin opencode version. Document upgrade procedure.

2. **Per-job working directory** — `os.tmpdir()/review-{job_id}/`. Create on job start; `rm -rf` in a `finally` block.

3. **Fetch a fresh GitHub token** for the job:
   - Look up the job's `user_id`.
   - Use Supabase service role to read the user's stored `provider_token` (and refresh it if expired).
   - Construct the clone URL as `https://x-access-token:${TOKEN}@github.com/${owner}/${repo}.git`.
   - **Never log the token.**

4. **Shallow clone**:
   - PR target: `git clone --depth=1 --branch <head_ref> <url>`, then `git fetch --depth=1 origin <base_sha>` to make `git diff base..head` work.
   - Branch target: `git clone --depth=1 --branch <ref> <url>`, then `git fetch --depth=1 origin <default_branch>` for the diff base.
   - Verify the actual cloned HEAD SHA matches `review_jobs.head_sha`. If the PR has moved since job creation, mark the job as error and tell the user to retry.

5. **Compute the diff** — `git diff <base_sha>..<head_sha>` saved to a file in the working dir. This is what we pass to opencode.

6. **Apply file filter** — port `ai-file-filter.ts` from the POC. Decide enforcement strategy (see Open Questions). Pin the strategy and document.

7. **Build the opencode prompt** — port `narrative-prompt.ts` from the POC, adapted:
   - System prompt instructs opencode to produce structured JSON in the POC narrative shape.
   - User prompt includes the diff (truncated at the same 80k token limit) + PR/branch metadata.
   - Tell opencode it has filesystem access to the repo as additional context if needed.

8. **Invoke opencode** — `child_process.spawn('opencode', [...args], { cwd: cloneDir, env: { ...process.env, OPENCODE_API_KEY } })`. Stream stdout. Buffer until structured JSON arrives at the end (Phase 5 handles incremental streaming; for now Phase 4 only needs final output).

9. **Parse output** — validate against a Zod schema for the POC narrative shape. On parse failure, mark the job as error with the raw output preserved in `error_message` (or a separate column).

10. **Persist** — insert into `reviews` with `content = parsedReview`; update `review_jobs` to `status='done'`, `completed_at=now()`.

11. **Cancellation** — long-running poll (or a Postgres `LISTEN` channel) re-checks `status='cancelled'` every ~2s; when seen, send `SIGTERM` to the opencode child, wait briefly, then `SIGKILL`. Clean up the clone dir.

12. **Error handling** — distinguish: clone failure (network / auth), opencode timeout, opencode non-zero exit, parse failure. Each gets a different `error_message` prefix. All of them clean up the clone dir.

## Modularity for future Claude-Code-SDK swap

Define a worker-internal interface:

```ts
type ReviewExecutor = {
  name: 'opencode' | 'claude-code';
  run(input: { cloneDir: string; diff: string; metadata: TargetMetadata; signal: AbortSignal }): Promise<NarrativeReview>;
};
```

Phase 4 implements only the opencode executor. The worker entry point picks an executor by env var (`REVIEW_EXECUTOR=opencode`, default). Adding the Claude-Code-SDK executor later is a single new file, no changes to the queue / DB / API layers.

## Out of scope (deferred)

- Token-by-token streaming to the frontend (Phase 5 — Phase 4 only stores the final review).
- Repo cache reuse / persistent clones — every job clones fresh per the original decision.
- Multiple repos in flight on one worker — assume one job at a time per worker; concurrency comes in Phase 7.

## Open questions

- **File filter enforcement strategy** — three options:
  1. Delete filtered files from the clone after `git clone` so opencode can't read them. Simple, irreversible within the working dir. **Probably the right choice.**
  2. Write an `AGENTS.md` (or whatever opencode uses) that tells the agent to avoid those globs. Relies on opencode obeying instructions; weaker guarantee.
  3. Sparse checkout. Most invasive; not worth it for v1.

- **opencode authentication** — confirm whether opencode-zen API key is configured via `OPENCODE_API_KEY` env var or a config file. Verify against opencode docs at planning time (use context7 / opencode docs).

- **How does opencode emit structured output?** — does its `--output-format json` (or equivalent) exist? If opencode only outputs free-form text, we need a stricter prompt + a robust parser. **Verify before planning.**

- **Token expiry during long runs** — a long opencode run could outlive the GitHub token. Since we only need the token for the initial clone, this should be fine — but confirm we don't need it for any later step.

- **Diff size limits** — POC truncates at 80k tokens. Should we surface a "diff too large, review may be incomplete" warning to the user? Decide during planning.
