#!/usr/bin/env bash
#
# Apply SQL migrations from supabase/migrations/ in order against the
# running Supabase Postgres container.
#
# Idempotent: each migration file is expected to use `if not exists` /
# `on conflict do nothing` patterns so re-running is a no-op.
#
# Usage:
#   ./scripts/db-migrate.sh
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations_dir="$repo_root/supabase/migrations"

if [ ! -d "$migrations_dir" ]; then
  echo "No migrations directory at $migrations_dir" >&2
  exit 1
fi

# Pull POSTGRES_PASSWORD/POSTGRES_DB from supabase/.env without sourcing
# the whole file (some upstream values contain spaces and break `set -a`).
read_env() {
  local key="$1"
  local file="$repo_root/supabase/.env"
  if [ -f "$file" ]; then
    sed -n "s/^${key}=//p" "$file" | head -n1
  fi
}

POSTGRES_DB="${POSTGRES_DB:-$(read_env POSTGRES_DB)}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(read_env POSTGRES_PASSWORD)}"

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_PASSWORD must be set (check supabase/.env)" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^supabase-db$'; then
  echo "supabase-db container is not running. Start the stack with:" >&2
  echo "  docker compose -f supabase/docker-compose.yml up -d" >&2
  exit 1
fi

shopt -s nullglob
migrations=("$migrations_dir"/*.sql)
shopt -u nullglob

if [ ${#migrations[@]} -eq 0 ]; then
  echo "No migration files found in $migrations_dir"
  exit 0
fi

for f in "${migrations[@]}"; do
  echo ">> Applying $(basename "$f")"
  docker exec -i \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    supabase-db \
    psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" < "$f"
done

echo "All migrations applied."
