#!/usr/bin/env bash
# Apply all Supabase migrations + seed to a throwaway local Postgres and run supabase/tests/*.test.sql.
# Requires: initdb, pg_ctl, psql (PostgreSQL 15+). Emulates the Supabase pieces the schema needs:
# auth.uid() from request.jwt.claim.sub, and the anon/authenticated roles with default grants.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${HALOX_SQL_PORT:-55433}"
WORK="$(mktemp -d /tmp/hxpg.XXXXXX)"   # short path: Unix socket paths are limited to ~100 bytes
export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres

cleanup() {
  pg_ctl -D "$WORK/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

initdb -D "$WORK/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$WORK/data" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$WORK/pg.log" -w start >/dev/null

psql -q -c "create database halox_verify;"
psql -d halox_verify -q -v ON_ERROR_STOP=1 <<'SQL'
create role authenticated nologin;
create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
SQL

for f in "$ROOT"/supabase/migrations/*.sql "$ROOT"/supabase/seed.sql; do
  psql -d halox_verify -q -v ON_ERROR_STOP=1 -c "set client_min_messages = warning;" -f "$f" >/dev/null
  echo "applied $(basename "$f")"
done

# Supabase grants table/function access to these roles by default; RLS does the isolation.
psql -d halox_verify -q -v ON_ERROR_STOP=1 <<'SQL'
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.reserve_unit_with_bypass(uuid, text, integer, text),
  public.commit_reservation(uuid), public.release_reservation(uuid) to authenticated, anon;
SQL

status=0
for t in "$ROOT"/supabase/tests/*.test.sql; do
  if out="$(psql -d halox_verify -q -tA -v ON_ERROR_STOP=1 -f "$t" 2>&1)"; then
    echo "PASS $(basename "$t")"
  else
    echo "FAIL $(basename "$t")"
    echo "$out" | grep -E 'ERROR|FAIL' | head -3
    status=1
  fi
done
exit "$status"
