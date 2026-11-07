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
  node="$(python3 -c 'import json; print(json.load(open("/etc/trlka-ha/automatic.json"))["node"])' 2>/dev/null || true)"
  if [[ "$streams" -lt 1 ]]; then
    python3 /usr/local/lib/trlka-ha/primary_guard.py
    python3 -c 'import json; assert json.load(open("/run/trlka-ha/owner.json")).get("allowAsync") is True'
    echo 'TRLKA_HA_DEGRADED serving_without_synchronous_peer'
  fi
  if [[ "$node" == petersburg ]]; then snapshot=''; else snapshot=/var/lib/trlka-ha-export/snapshot-at; fi
else
  test "$role" = reserve
  test "$recovery" = t
  streams="$(runuser -u postgres -- psql -Atc "SELECT count(*) FROM pg_stat_wal_receiver WHERE status='streaming'")"
  test "$streams" -eq 1
  snapshot=/var/lib/trlka-ha-standby-files/snapshot-at
fi
if [[ -n "$snapshot" ]]; then
  test -s "$snapshot"
  test "$(( $(date +%s) - $(stat -c %Y "$snapshot") ))" -lt 1200
fi
test "$(df --output=avail -B1 / | tail -1 | tr -d ' ')" -gt 536870912
echo "TRLKA_HA_HEALTH_OK role=$role"
