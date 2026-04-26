# Phase 5 — Streaming output end-to-end

## Goal

Wire opencode's stdout into the `review_chunks` table as it streams, and have the frontend render incrementally via Supabase Realtime. Reviews now feel "live" — and a reload mid-stream picks up where the user left off.

## Demoable at end

- Watching a running review shows a checklist of chapter titles forming as opencode produces them, with a typing cursor on the in-progress one.
- Reloading the page mid-stream rebuilds the partial state from `review_chunks` and continues streaming.
- When opencode finishes, the final `reviews` row is written and the status flips to `done`. The chapter checklist locks in (no cursor) and a "View rendered review →" CTA appears, linking to `/reviews/:id` (Phase 6 fills in the target).
- Cancelling mid-stream stops new chunks and the UI shows "Cancelled" with the partial chapter list preserved.

## Decisions (resolved during discussion)

| Topic                  | Decision                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Live preview UX        | Vertical checklist of detected chapter titles with a typing cursor on the latest one. No raw stdout textbox in the UI — the chunks are an implementation detail. |
| Parse location         | Frontend re-parses the accumulated raw text on every Realtime event. Worker stays dumb (just batches + writes bytes). Reload resilience is automatic — the parser re-runs over the rebuilt buffer. |
| Final-output handling  | Strategy A — opencode-zen GLM emits a single JSON blob wrapped in `<narrative_review>` tags. We parse only at stream end (already done in Phase 4). The streamed chunks are an "in-progress preview" replaced by the final review row when status flips to `done`. |
| Streaming plumbing     | Add `onChunk?: (text: string) => void` to `ReviewExecutorInput`. The executor calls it for every stdout `data` event. The worker layer wraps the callback with a batcher (see below) that assigns `seq` and writes to `review_chunks`. Stub executor uses the same path so dev mode exercises the streaming code. |
| Batch cadence          | 100ms or 256B, whichever first. Flush on close. Per-job in-memory `seq` counter so chunks land in order without DB-side coordination. |
| Backpressure cap       | Hard cap at 5000 chunks per job. Hitting the cap aborts the opencode subprocess, marks the job as `error` with `error_message='stream cap exceeded'`, and writes **no** `reviews` row. Pure error — no last-ditch parse of the buffered text. |
| Realtime channels      | Per-job channel with server-side filters (already in place from Phase 3). No change. |
| Done-state UI          | When `status='done'`, freeze the chapter checklist (cursor off) and show a "View rendered review →" button to `/reviews/:id`. The button is fine pointing at a 404 until Phase 6 ships. |
| Cleanup / retention    | Deferred to Phase 7. Closed-beta volume is too small to need it now, and Phase 7 already plans to revisit retention with full context. |

## Tasks

1. **`ReviewExecutor` interface change** — add `onChunk?: (text: string) => void` to `ReviewExecutorInput` in `packages/worker/src/executor/types.ts`. Existing tests / callers that don't care can omit it. Document that chunks are raw stdout bytes converted to UTF-8; ordering matches stdout `data` event order.

2. **`OpencodeExecutor` streaming refactor** — in `collectChildOutput`, alongside the existing `stdoutChunks: Buffer[]` accumulator, push each `data` event into the `onChunk` callback (decoded as UTF-8). The full buffer still resolves at `close` for the existing `parseNarrativeReview` call — we are adding a side-channel, not changing how the final parse works. Stderr is **not** streamed.

3. **Stub executor — new file `packages/worker/src/executor/stub-executor.ts`** — implements `ReviewExecutor` using the same `onChunk` mechanism. Emits a synthetic JSON-shaped fragment over ~5s (e.g. `'<narrative_review>{"prTitle":"...","chapters":[{"title":"Shape of the change",...},...]}</narrative_review>'`) split across multiple `onChunk` calls so the partial parser actually has something to work with in dev. `runStubJob` is reworked to delegate to this executor. The hard-coded `NarrativeReview` from Phase 3 becomes the structured payload behind the stub stream.

4. **Chunk batcher — new file `packages/worker/src/streaming/chunk-batcher.ts`** — exposes `createChunkBatcher({ supabase, jobId, maxChunks }) => { onChunk(text), flush(), getCount() }`. Internally:
   - Buffers incoming text in memory with a soft trigger of 100ms or 256 bytes (whichever first).
   - Maintains a per-job `seq` counter starting at 0.
   - Calls `insertChunk(supabase, jobId, seq, content)` per flush. Multiple buffered fragments concatenate into one row.
   - When `getCount() >= 5000`, throw `StreamCapExceededError` from the next `onChunk` so `runOpencodeJob` can abort the executor.
   - `flush()` is idempotent; called from a `finally` to ensure the tail makes it to the DB even on error/cancel.

5. **Wire batcher into `runOpencodeJob`** — in `packages/worker/src/opencode-job.ts`, create a batcher per job, pass `onChunk: batcher.onChunk` into `executor.run()`. Wrap the executor call in try/finally so `batcher.flush()` always runs. On `StreamCapExceededError`, call `controller.abort()` (already in scope via `signal`'s parent) and treat as an error outcome with the canonical `error_message='stream cap exceeded'`. Existing cancellation / cleanup paths stay unchanged.

6. **Frontend partial-JSON parser — new file `src/lib/jobs/partial-narrative-parse.ts`** — pure function `extractChapterTitles(buffer: string): { titles: string[]; inProgressTitle: string | null }`. Strategy:
   - Find the first occurrence of `"chapters"` followed by `[`.
   - From there, scan for `"title"` field tokens and capture string contents.
   - The last `"title"` whose closing `"` hasn't appeared yet is the in-progress one (cursor goes there).
   - Forgiving — any parse failure returns `{ titles: [], inProgressTitle: null }`. The UI falls back to a generic "Streaming…" state.
   Unit-test heavily; this is the trickiest piece in the phase.

7. **`/jobs/:id` UI rewrite — `JobLiveView` and a new `ChapterChecklist` component** —
   - Maintain an accumulated `string` buffer of all chunk content (stable across reloads because we hydrate from existing chunks).
   - Memoize `extractChapterTitles(buffer)` on every render that buffer changes.
   - Render `<ChapterChecklist titles={titles} inProgress={inProgressTitle} status={status} />` — a vertical list with `✓` for completed titles and a typing cursor (`▍` or CSS animation) on the in-progress one.
   - Footer shows "Streaming for {seconds}s" while running, freezes on done/error/cancelled.
   - On `status='done'`, remove cursor + show "View rendered review →" link to `/reviews/:id`.
   - On `status='error'`, show `error_message` (especially "stream cap exceeded") instead of the chapter list footer.
   - Drop the existing raw-text `ChunksBox` component.

8. **Reload resilience** — the existing server-component shell already fetches `review_chunks` ordered by `seq` and hands them to `JobLiveView`. The Realtime subscription dedupes by row `id`. No change needed beyond the new buffer-accumulation logic in step 7.

## Out of scope (deferred)

- The polished chapter / insight / inline-diff UI (Phase 6).
- "Resume from chunk N" if the worker crashes mid-job — Phase 7 will decide whether to support resumption or just retry-from-scratch.
- `review_chunks` retention / cleanup (Phase 7).
- Token-level streaming if opencode-zen ever exposes it — current GLM emits stdout in coarse bursts, fine for our 100ms cadence.

## Tests

- **Worker unit tests** (Vitest):
  - `chunk-batcher.test.ts`: time-based flush, byte-threshold flush, flush-on-close, seq monotonicity, cap-exceeded throws.
  - `stub-executor.test.ts`: emits the expected JSON-shape across multiple `onChunk` calls; final review payload is the same `NarrativeReview` shape Phase 3 wrote.
  - Update `opencode-executor.test.ts` to assert `onChunk` is invoked for each stdout `data` event and the final `parseNarrativeReview` still works on the buffered total.
  - Update `opencode-job.test.ts` for the cap-exceeded path: cap fires → SIGTERM the executor → `error_message='stream cap exceeded'`, no `reviews` row.

- **Frontend unit tests** (Vitest):
  - `partial-narrative-parse.test.ts`: completed JSON, half-finished title, no `chapters` key yet, malformed input, edge cases (escaped quotes in titles, multiple chapters).

- **No new RLS tests** — schema is unchanged. Existing Phase 3 RLS smoke covers `review_chunks` visibility.

## Risks

- **Partial JSON parser fragility.** Hand-rolled regex/state-machine over partial JSON is the part most likely to misbehave on real opencode output. Mitigation: keep the fallback completely silent (return empty list, never throw to React), and lean on unit tests with realistic fixtures captured from a Phase 4 run. If it consistently misbehaves with the real GLM model, fall back to the simpler "raw text in a textbox" preview rather than shipping a flaky checklist.
- **5000-chunk cap is a guess.** With a 100ms / 256B batcher, 5000 chunks ≈ 8 minutes of continuous streaming or ~1.25MB of stdout. Both should be well above any normal opencode run for a single PR review, but if real runs ever come close we'll see false aborts. Worth re-measuring in beta and tuning.
- **Stub diverging from real executor.** The stub now emits structured JSON across multiple chunks to drive the preview UI. If the real opencode-zen output layout changes, the parser may regress against real output while still passing on stub fixtures. Capture at least one real-run fixture in the parser tests so this can't drift silently.
