#!/usr/bin/env bash
set -euo pipefail
role="$(cat /etc/trlka-ha/role)"
recovery="$(runuser -u postgres -- psql -Atc 'SELECT pg_is_in_recovery()')"
if [[ "$role" == primary ]]; then
  test "$recovery" = f
  curl -fsS --max-time 5 http://127.0.0.1:8790/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and d.get("service")=="freetalk-api"'
  curl -fsS --max-time 5 http://127.0.0.1:8787/health | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok") and d.get("service")=="freetalk-signaling"'
  runuser -u postgres -- psql -Atc "SELECT application_name,state,COALESCE(pg_wal_lsn_diff(pg_current_wal_lsn(),replay_lsn),-1) AS lag_bytes FROM pg_stat_replication"
  streams="$(runuser -u postgres -- psql -Atc "SELECT count(*) FROM pg_stat_replication WHERE state='streaming'")"
  test "$streams" -ge 1
  snapshot=/var/lib/trlka-ha-export/snapshot-at
else
  test "$role" = reserve
  test "$recovery" = t
  streams="$(runuser -u postgres -- psql -Atc "SELECT count(*) FROM pg_stat_wal_receiver WHERE status='streaming'")"
  test "$streams" -eq 1
  snapshot=/var/lib/trlka-ha-standby-files/snapshot-at
fi
test -s "$snapshot"
test "$(( $(date +%s) - $(stat -c %Y "$snapshot") ))" -lt 1200
test "$(df --output=avail -B1 / | tail -1 | tr -d ' ')" -gt 536870912
echo "TRLKA_HA_HEALTH_OK role=$role"
