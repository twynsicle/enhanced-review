# Vendored from supabase/supabase

This directory is a **direct copy** of the `docker/` subdirectory in the
official Supabase self-hosting repo. It is intentionally vendored as-is
so we can pull upstream fixes with a clean diff.

## Source

- Repo: <https://github.com/supabase/supabase>
- Path: `docker/`
- Vendored commit: `07d75d4e799f1df21a6c8debdaea75ebddd977a5` (2026-04-24)

## Local additions (NOT in upstream)

- `migrations/` — our SQL migrations, applied via `scripts/db-migrate.sh`
- `.env` — locally generated from `.env.example` via `utils/generate-keys.sh`
  (gitignored)
- This file (`UPSTREAM.md`)

## Local edits to vendored files

Tracked here so upstream merges can re-apply them. Each edit is grep-able
in the file via the `Local edit (see supabase/UPSTREAM.md)` marker.

- **`docker-compose.yml`** (around the `auth:` service env block, ~line 197):
  uncommented the four `GOTRUE_EXTERNAL_GITHUB_*` lines. This is the
  documented step for enabling the GitHub OAuth provider per
  `.env.example`'s instructions.

## Updating

To pull upstream changes:

```bash
git clone --depth=1 https://github.com/supabase/supabase.git /tmp/supa
diff -ru /tmp/supa/docker enhanced-review/supabase \
  --exclude=migrations --exclude=UPSTREAM.md --exclude=.env
```

Resolve any divergence carefully — we deliberately keep this tree clean
of local edits so the diff stays meaningful.
