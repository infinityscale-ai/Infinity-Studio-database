#!/usr/bin/env bash
# Smoke test of the embedded studio: mint, claim, query, deny, redact, revoke, and prove no secret reached a log or disk.
# Env: PG_URL (postgres://user:pass@host:port/db) to reuse a database, INFSTUDIO_SERVER_BIN to test a compiled server,
#      INFSTUDIO_STATIC_DIR (default out/) for the page checks, SMOKE_PORT / SMOKE_ADMIN_PORT / SMOKE_PG_PORT to move ports.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=${SMOKE_PORT:-3867}
ADMIN_PORT=${SMOKE_ADMIN_PORT:-4101}
PG_PORT=${SMOKE_PG_PORT:-15432}
PG_CONTAINER=infstudio-smoke-pg
STATIC_DIR=${INFSTUDIO_STATIC_DIR:-$ROOT/out}
CONSOLE=http://127.0.0.1:8080
WORK=$(mktemp -d)
KEY=$(openssl rand -hex 32)
PASSWORD=$(openssl rand -hex 12)
SERVER_PID=""
FAILS=0
P="127.0.0.1:$PORT"
A="127.0.0.1:$ADMIN_PORT"

# Stops the server and the throwaway database, and removes the work dir.
cleanup() {
  [[ -n $SERVER_PID ]] && kill "$SERVER_PID" 2>/dev/null || true
  [[ -z ${PG_URL:-} ]] && docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Prints one PASS line.
pass() { printf 'PASS  %s\n' "$1"; }
# Prints one FAIL line and counts it.
fail() { printf 'FAIL  %s (%s)\n' "$1" "$2"; FAILS=$((FAILS + 1)); }
# Compares an actual value with the expected one.
check() { if [[ $3 == "$2" ]]; then pass "$1"; else fail "$1" "expected $2, got $3"; fi; }
# Evaluates a Python expression over the JSON on stdin (d).
json() { python3 -c 'import sys, json; d = json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }
# Sends a request, prints the status code, and leaves the body in $WORK/body.
code() { curl -s -o "$WORK/body" -w '%{http_code}' "$@"; }

# Starts (or parses) the PostgreSQL the session will point at and exports its parts.
prepare_postgres() {
  if [[ -n ${PG_URL:-} ]]; then
    read -r PG_HOST PG_PORT PG_USER PASSWORD PG_DB < <(python3 -c '
import sys; from urllib.parse import urlparse, unquote
u = urlparse(sys.argv[1]); print(u.hostname, u.port or 5432, unquote(u.username or ""), unquote(u.password or ""), u.path.lstrip("/"))' "$PG_URL")
    return
  fi
  PG_HOST=127.0.0.1; PG_USER=postgres; PG_DB=smoke
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$PG_CONTAINER" -e POSTGRES_PASSWORD="$PASSWORD" -e POSTGRES_DB="$PG_DB" -p "127.0.0.1:$PG_PORT:5432" postgres:16-alpine >/dev/null
  for _ in $(seq 1 60); do docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && return; sleep 0.5; done
  echo "postgres did not become ready" >&2; exit 1
}

# Starts the studio server in embed mode on the work dir and waits for its health route.
start_server() {
  local cmd=(bun run "$ROOT/server/index.ts")
  [[ -n ${INFSTUDIO_SERVER_BIN:-} ]] && cmd=("$INFSTUDIO_SERVER_BIN")
  mkdir -p "$WORK/data"
  INFSTUDIO_EMBED_MODE=1 INFSTUDIO_BIND=127.0.0.1 INFSTUDIO_SERVER_PORT=$PORT INFSTUDIO_ADMIN_BIND=127.0.0.1 \
    INFSTUDIO_ADMIN_PORT=$ADMIN_PORT INFSTUDIO_ADMIN_KEY=$KEY INFSTUDIO_CONSOLE_ORIGIN=$CONSOLE \
    INFSTUDIO_EMBED_ALLOWED_ORIGINS=$CONSOLE INFSTUDIO_USER_DATA_DIR=$WORK/data INFSTUDIO_MCP_DISABLED=1 \
    INFSTUDIO_STATIC_DIR=$STATIC_DIR "${cmd[@]}" >"$WORK/server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do curl -sf "$P/health" >/dev/null 2>&1 && return; sleep 0.5; done
  echo "server did not start:" >&2; cat "$WORK/server.log" >&2; exit 1
}

# Runs the session sequence a console and its iframe perform, checking each answer.
run_sequence() {
  local body="{\"externalId\":\"u1/db1\",\"userId\":\"u1\",\"dbId\":\"db1\",\"label\":\"smoke\",\"engine\":\"postgres\",\"host\":\"$PG_HOST\",\"port\":$PG_PORT,\"username\":\"$PG_USER\",\"password\":\"$PASSWORD\",\"database\":\"$PG_DB\",\"ttlSeconds\":600}"
  check "admin without key is 401" 401 "$(code -X POST "$A/admin/v1/embed-sessions")"
  check "mint returns 201" 201 "$(code -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -X POST "$A/admin/v1/embed-sessions" -d "$body")"
  local token cid; token=$(json "d['token']" <"$WORK/body"); cid=$(json "d['connectionId']" <"$WORK/body")
  check "unauthenticated API call is 401" 401 "$(code "$P/api/connections")"
  check "claim returns 200" 200 "$(code -H 'Content-Type: application/json' -X POST "$P/api/embed/claim" -d "{\"token\":\"$token\"}")"
  local bearer; bearer=$(json "d['data']['session']" <"$WORK/body")
  local H=(-H "Authorization: Bearer $bearer" -H 'Content-Type: application/json')
  code "${H[@]}" -X POST "$P/api/tables" -d '{"connectionString":"postgres://bogus","schema":"public","options":{}}' >/dev/null
  check "tables succeed with a bogus client string (substitution)" True "$(json "d['success']" <"$WORK/body")"
  code "${H[@]}" -X POST "$P/api/sql/run" -d '{"connectionString":"postgres://bogus","query":"select 1 as x"}' >/dev/null
  check "sql/run returns rows" "[{'x': 1}]" "$(json "d['data']['rows']" <"$WORK/body")"
  check "connection list is forbidden" 403 "$(code "${H[@]}" "$P/api/connections")"
  check "another connection's history is forbidden" 403 "$(code "${H[@]}" "$P/studio/999/history")"
  check "snapshot creation is forbidden" 403 "$(code "${H[@]}" -X POST "$P/api/actions/createSnapshot" -d '{"args":["x","n","d",1]}')"
  check "bootstrap returns 200" 200 "$(code "${H[@]}" "$P/studio/$cid/bootstrap")"
  check "bootstrap is redacted" "('embed://$cid', None, None, None)" "$(json "(c:=d['data']['connection'], (c['connectionString'], c['host'], c['password'], c['username']))[1]" <"$WORK/body")"
  check "second claim is 410" 410 "$(code -H 'Content-Type: application/json' -X POST "$P/api/embed/claim" -d "{\"token\":\"$token\"}")"
  check "revoke by db returns 200" 200 "$(code -H "Authorization: Bearer $KEY" -X DELETE "$A/admin/v1/embed-sessions?db=db1")"
  check "revoke counts the session" True "$(json "d['revoked'] >= 1" <"$WORK/body")"
  check "revoked bearer is 401" 401 "$(code "${H[@]}" -X POST "$P/api/sql/run" -d '{"connectionString":"x","query":"select 1"}')"
}

# Checks the page routes when a static export is available.
check_pages() {
  if [[ ! -f $STATIC_DIR/embed/index.html ]]; then printf 'SKIP  page checks (no %s/embed/index.html)\n' "$STATIC_DIR"; return; fi
  check "GET / is 404" 404 "$(code "$P/")"
  check "GET /embed/ is 200" 200 "$(code -D "$WORK/headers" "$P/embed/")"
  check "embed page carries frame-ancestors" 1 "$(grep -ci "frame-ancestors 'self' $CONSOLE" "$WORK/headers")"
  check "embed page is no-store" 1 "$(grep -ci 'cache-control: no-store' "$WORK/headers")"
}

# Proves the password and the connection string reached neither the log nor sqlite.db.
check_leaks() {
  check "log has no password" 0 "$(grep -c "$PASSWORD" "$WORK/server.log" || true)"
  check "log has no connection string" 0 "$(grep -c 'postgres://' "$WORK/server.log" || true)"
  check "sqlite.db keeps no password or connection string" 0 "$(python3 -c '
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
print(db.execute("select count(*) from connections where password is not null or connection_string like \"postgres://%\"").fetchone()[0]
      + sum(db.execute(f"select count(*) from {t} where connection_string like \"postgres://%\"").fetchone()[0] for t in ("schema_cache_meta", "schema_cache_schemas", "schema_cache_tables")))' "$WORK/data/sqlite.db")"
}

prepare_postgres
start_server
run_sequence
check_pages
check_leaks
if [[ $FAILS -gt 0 ]]; then printf '%d check(s) failed\n' "$FAILS"; exit 1; fi
echo "all checks passed"
