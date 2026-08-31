#!/usr/bin/env bash
set -euo pipefail

artifact=${1:?API archive is required}
expected_version=${2:?Expected API version is required}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
current=/opt/freetalk/api
stage="/opt/freetalk/api-stage-${expected_version}-${timestamp}"
rollback="/opt/freetalk/api-rollback-${expected_version}-pre-${timestamp}"
failed="/opt/freetalk/api-failed-${expected_version}-${timestamp}"
rehearsal_unit="freetalk-api-rehearsal-${timestamp,,}"

test -f "$artifact"
test -d "$current"
test -d "$current/node_modules"
test ! -e "$stage"
test ! -e "$rollback"

mkdir -p "$stage"
tar -xzf "$artifact" -C "$stage"
cp -a "$current/node_modules" "$stage/node_modules"
chown -R freetalk:freetalk "$stage"
/opt/node-v22/bin/node --check "$stage/dist/server.js"

systemd-run --quiet --unit="$rehearsal_unit" \
  -p User=freetalk \
  -p Group=freetalk \
  -p WorkingDirectory="$stage" \
  -p EnvironmentFile=/etc/freetalk/api.env \
  /usr/bin/env API_PORT=8791 /opt/node-v22/bin/node "$stage/dist/server.js"

rehearsal_ok=false
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8791/health | grep -Fq "\"version\":\"$expected_version\""; then
    rehearsal_ok=true
    break
  fi
  sleep 0.5
done
systemctl stop "$rehearsal_unit" || true
systemctl reset-failed "$rehearsal_unit" || true
if [[ "$rehearsal_ok" != true ]]; then
  echo "API rehearsal health failed" >&2
  exit 1
fi

systemctl stop freetalk-api
mv "$current" "$rollback"
mv "$stage" "$current"
if systemctl start freetalk-api; then
  production_ok=false
  for _ in $(seq 1 20); do
    if curl -fsS http://127.0.0.1:8790/health | grep -Fq "\"version\":\"$expected_version\""; then
      production_ok=true
      break
    fi
    sleep 0.5
  done
  if [[ "$production_ok" == true ]]; then
    echo "API deployed: $expected_version"
    echo "Rollback path: $rollback"
    exit 0
  fi
fi

systemctl stop freetalk-api || true
mv "$current" "$failed"
mv "$rollback" "$current"
systemctl start freetalk-api
echo "API deployment failed and was rolled back; failed path: $failed" >&2
exit 1
