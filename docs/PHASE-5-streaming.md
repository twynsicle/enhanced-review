# Phase 5 — Streaming output end-to-end

## Goal

Wire opencode's stdout into the `review_chunks` table as it streams, and have the frontend render incrementally via Supabase Realtime. Reviews now feel "live" — and a reload mid-stream picks up where the user left off.

## Demoable at end

- Watching a running review shows tokens / chapter content appearing as opencode produces them.
- Reloading the page mid-stream rebuilds the partial state from `review_chunks` and continues streaming.
- When opencode finishes, the final `reviews` row is written and the status flips to `done`. The UI swaps from "streaming" mode to "rendered review" mode without flicker.
- Cancelling mid-stream stops new chunks and the UI shows "Cancelled" with the partial output preserved.

## Tasks

1. **Worker streaming** — replace the buffer-until-end logic from Phase 4. As opencode emits stdout, write each chunk into `review_chunks` with an incrementing `seq`. Batch tiny chunks (e.g., 100ms or 256 bytes, whichever first) to avoid hammering Postgres.

2. **Final-output handling** — opencode's structured JSON arrives at end-of-stream. Strategy depends on what we learned in Phase 4:
   - If opencode emits a single JSON blob: parse only after stream end; the streamed chunks are an "in-progress" preview that gets _replaced_ by the rendered review when finalized.
   - If opencode emits structured events incrementally: parse as we go; chunks are the structured updates themselves.
     Pick during planning; both are workable.

3. **Frontend partial rendering** — `/jobs/:id` page subscribes to:
   - `review_jobs` row updates (status changes).
   - `review_chunks` inserts for that `job_id`.
     Buffers chunks ordered by `seq`. Renders a "live preview" view while `status='running'`. Once `status='done'` and the `reviews` row exists, swaps to the rendered chapter UI (Phase 6).

4. **Reload resilience** — on page mount, fetch all existing `review_chunks` for the job up to current, then subscribe for new ones starting from `seq > last_seen`. No gap, no duplicate.

5. **Backpressure / chunk count limit** — cap `review_chunks` per job (e.g., 5000). If exceeded, drop the rest and rely on the final review row. Prevents unbounded growth on a stuck stream.

6. **Cleanup policy** — after a configurable delay (e.g., 7 days), `review_chunks` are deleted; the `reviews` row stays forever. Implement as a `pg_cron` job or a periodic worker task. Revisit retention in Phase 7.

## Out of scope (deferred)

- The polished chapter / insight / inline-diff UI (Phase 6).
- "Resume from chunk N" if the worker crashes mid-job — Phase 7 will decide whether to support resumption or just retry-from-scratch.

## Open questions

- **Single Realtime channel per job, or one big channel filtered by `job_id`?** — per-job is cleaner but Supabase has connection limits. Filtered is more efficient. Confirm during planning.
- **Token-level vs line-level chunks** — depends entirely on what opencode emits. Resolve in Phase 4 verification.
- **Rendering "in-progress" preview** — is it raw text? A best-effort partial parse of the JSON? A placeholder spinner with chapter titles? UX decision.
