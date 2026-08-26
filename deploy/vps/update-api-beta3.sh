#!/usr/bin/env bash
set -Eeuo pipefail

release="0.4.0-beta.3"
artifact="/tmp/freetalk-api-${release}-vps.tar.gz"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging="/opt/freetalk/api-release-${release}-${timestamp}"
rollback="/opt/freetalk/api-rollback-${timestamp}"
failed="/opt/freetalk/api-failed-${timestamp}"
database_backup="/var/backups/freetalk/api-before-${release}-${timestamp}.dump"

test "$(realpath /opt/freetalk)" = "/opt/freetalk"
test -f "$artifact"
test -d /opt/freetalk/api

install -d -m 700 /var/backups/freetalk
sudo -u postgres pg_dump --format=custom freetalk >"$database_backup"
chmod 600 "$database_backup"

install -d -m 755 "$staging"
tar -xzf "$artifact" -C "$staging"
cd "$staging"
/opt/node-v22/bin/npm install --omit=dev --no-audit --no-fund
/opt/node-v22/bin/node --check dist/server.js
/opt/node-v22/bin/node --check dist/migrate.js
chown -R freetalk:freetalk "$staging"

systemctl stop freetalk-api
mv /opt/freetalk/api "$rollback"
mv "$staging" /opt/freetalk/api

if systemctl start freetalk-api; then
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:8790/health >/tmp/freetalk-api-health.json; then
      cat /tmp/freetalk-api-health.json
      printf '\nbackup=%s\nrollback=%s\n' "$database_backup" "$rollback"
      exit 0
    fi
    sleep 1
  done
fi

systemctl stop freetalk-api || true
mv /opt/freetalk/api "$failed"
mv "$rollback" /opt/freetalk/api
systemctl start freetalk-api
echo "Deployment failed; previous API restored" >&2
exit 1
