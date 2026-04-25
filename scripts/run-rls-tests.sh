#!/usr/bin/env bash
#
# Run the Phase 3 RLS smoke tests against the dev Supabase Postgres.
#
# Prerequisites:
#   - `docker compose -f supabase/docker-compose.yml up -d` (or the dev
#     overlay) is running and the `supabase-db` container is up.
#   - `./scripts/db-migrate.sh` has applied all migrations through 0002.
#
# Exit code 0 = all tests passed (RAISE EXCEPTION translates to non-zero
# via psql's ON_ERROR_STOP).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tests_dir="$repo_root/supabase/tests-app"

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
  echo "supabase-db container is not running. Start the stack first:" >&2
  echo "  docker compose -f supabase/docker-compose.yml up -d" >&2
  exit 1
fi

shopt -s nullglob
tests=("$tests_dir"/*.sql)
shopt -u nullglob

if [ ${#tests[@]} -eq 0 ]; then
  echo "No RLS test files in $tests_dir" >&2
  exit 1
fi

for f in "${tests[@]}"; do
  echo ">> Running $(basename "$f")"
  docker exec -i \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    supabase-db \
    psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" < "$f"
done

echo "All RLS tests passed."
