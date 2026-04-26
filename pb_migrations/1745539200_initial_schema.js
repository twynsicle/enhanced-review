// Initial schema for the enhanced-review app.
//
// Defines four base collections that mirror the previous Postgres schema
// from supabase/migrations/0001..0003, with three deliberate differences:
//
//   - No `github_token_encrypted` column on review_jobs. Tokens live only
//     in memory during a job (passed via the in-process runner) and are
//     never persisted.
//   - No pgsodium encryption / decryption RPCs. Same reason.
//   - No pg_notify triggers. The runner is invoked directly by the API
//     route in-process, so no DB-level signalling is needed.
//
// The default `users` auth collection is created by PocketBase itself on
// first start; we don't redefine it here. GitHub OAuth provider settings
// are configured per-environment via the admin UI, not committed here.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // ------------------------------------------------------------------
    // allowed_users — invite-only allowlist of GitHub logins.
    // Server-only access (admin client). No user-facing rules.
    // ------------------------------------------------------------------
    const allowedUsers = new Collection({
      type: 'base',
      name: 'allowed_users',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: 'github_login', type: 'text', required: true, max: 100 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_allowed_users_github_login ON allowed_users (github_login)',
      ],
    });
    app.save(allowedUsers);

    // ------------------------------------------------------------------
    // review_jobs — one row per review submission.
    //
    // Authenticated users can list / view their own and others' jobs
    // (matches the previous "select all authenticated" RLS policy used
    // for the home / history views).
    //
    // Updates are rule-restricted to the owner and only while the job is
    // pending or running — this is the user-initiated cancel path. All
    // other writes (status transitions, error_message, started_at, etc.)
    // happen via the admin client from the in-process runner and bypass
    // collection rules.
    // ------------------------------------------------------------------
    const reviewJobs = new Collection({
      type: 'base',
      name: 'review_jobs',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: '@request.auth.id = user.id && (status = "pending" || status = "running")',
      deleteRule: null,
      fields: [
        {
          name: 'user',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: users.id,
          cascadeDelete: true,
        },
        { name: 'github_login', type: 'text', required: true, max: 100 },
        { name: 'target', type: 'json', required: true, maxSize: 4096 },
        {
          name: 'status',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['pending', 'running', 'done', 'error', 'cancelled'],
        },
        { name: 'head_sha', type: 'text', max: 64 },
        { name: 'started_at', type: 'date' },
        { name: 'completed_at', type: 'date' },
        { name: 'cancelled_at', type: 'date' },
        { name: 'error_message', type: 'text', max: 4096 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_review_jobs_status ON review_jobs (status)',
        'CREATE INDEX idx_review_jobs_user ON review_jobs (user)',
        'CREATE INDEX idx_review_jobs_created ON review_jobs (created)',
      ],
    });
    app.save(reviewJobs);

    // ------------------------------------------------------------------
    // reviews — final structured review output, one per completed job.
    // ------------------------------------------------------------------
    const reviews = new Collection({
      type: 'base',
      name: 'reviews',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'job',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: reviewJobs.id,
          cascadeDelete: true,
        },
        { name: 'content', type: 'json', required: true, maxSize: 1048576 },
        { name: 'diff_truncated', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_reviews_job ON reviews (job)',
      ],
    });
    app.save(reviews);

    // ------------------------------------------------------------------
    // review_chunks — streamed partial output rows for the live view.
    // The runner inserts one row per chunk during execution; the client
    // subscribes via realtime SSE, dedupes on `seq`.
    // ------------------------------------------------------------------
    const reviewChunks = new Collection({
      type: 'base',
      name: 'review_chunks',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'job',
          type: 'relation',
          required: true,
          maxSelect: 1,
          collectionId: reviewJobs.id,
          cascadeDelete: true,
        },
        { name: 'seq', type: 'number', required: true, onlyInt: true, min: 0 },
        { name: 'content', type: 'text', required: true, max: 65536 },
        { name: 'created', type: 'autodate', onCreate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_review_chunks_job_seq ON review_chunks (job, seq)',
      ],
    });
    app.save(reviewChunks);
  },
  (app) => {
    for (const name of ['review_chunks', 'reviews', 'review_jobs', 'allowed_users']) {
      try {
        const c = app.findCollectionByNameOrId(name);
        app.delete(c);
      } catch (_) {
        // already gone
      }
    }
  },
);
