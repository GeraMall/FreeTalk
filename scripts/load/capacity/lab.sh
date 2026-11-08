#!/usr/bin/env bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${TRLKA_CAPACITY_LAB:-}" = isolated-ci
test "${CAPACITY_STATE:-}" = "${RUNNER_TEMP}/trlka-capacity"
test "${CAPACITY_NODE:-}" != ''
export NODE_ENV=test API_HOST=127.0.0.1 API_PORT=8790
export API_PUBLIC_URL=http://127.0.0.1:18890 ALLOWED_ORIGIN=http://127.0.0.1:1420
export TOKEN_PEPPER=isolated-capacity-pepper-not-for-production
export INTERNAL_SIGNALING_SECRET=isolated-capacity-secret-not-for-production
export IP_HASH_SALT=isolated-capacity-salt-not-for-production
export TURNSTILE_SECRET_KEY=unused EMAIL_DELIVERY_MODE=log
export DATABASE_URL="postgresql://postgres@127.0.0.1:54329/trlka_capacity_${GITHUB_RUN_ID}"
export PATH="$(dirname "$CAPACITY_NODE"):/usr/lib/postgresql/16/bin:/usr/sbin:/usr/bin:/sbin:/bin"
# The runner's home/work tree is private to runner. PostgreSQL needs its own
# disposable directory, not relaxed permissions on that private tree.
pgroot="$(mktemp -d "/var/tmp/trlka-capacity-${GITHUB_RUN_ID}-XXXXXX")"
export PGDATA="${pgroot}/postgres"
mkdir -p "$PGDATA" "$pgroot/socket"
chown -R postgres:postgres "$pgroot"
runuser -u postgres -- initdb -D "$PGDATA" -A trust --no-locale > "$CAPACITY_STATE/initdb.log"
runuser -u postgres -- pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-h 127.0.0.1 -p 54329 -k $pgroot/socket -c shared_buffers=128MB -c max_connections=100" -w start
runuser -u postgres -- createdb -h 127.0.0.1 -p 54329 "trlka_capacity_${GITHUB_RUN_ID}"
"$CAPACITY_NODE" apps/api/dist/capacity-migrate.mjs > "$CAPACITY_STATE/migrations.log"
"$CAPACITY_NODE" scripts/load/capacity/seed.mjs > "$CAPACITY_STATE/seed.log"
# Only synthetic credentials are readable by the separate load generator.
chmod 644 "$CAPACITY_STATE/clients.json"
"$CAPACITY_NODE" apps/api/dist/capacity-server.mjs > "$CAPACITY_STATE/api.log" 2>&1 &
api_pid=$!
"$CAPACITY_NODE" scripts/load/capacity/gateway.mjs > "$CAPACITY_STATE/gateway.log" 2>&1 &
gateway_pid=$!
wait -n "$api_pid" "$gateway_pid"
