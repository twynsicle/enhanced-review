#!/bin/sh
# Container entrypoint. Runs migrations, then orphan-job recovery, then
# exec's the CMD ("node server.js"). `set -eu` not `set -euo pipefail`
# because Alpine's BusyBox sh doesn't reliably implement pipefail.
set -eu

echo "[entrypoint] running migrations…"
node /app/drizzle/migrate.mjs

echo "[entrypoint] seeding allowlist…"
node /app/scripts/db-seed.cjs || echo "[entrypoint] seed failed (continuing)"

echo "[entrypoint] recovering interrupted jobs…"
node /app/scripts/recover-jobs.cjs || echo "[entrypoint] recover failed (continuing)"

echo "[entrypoint] starting next…"
exec "$@"
