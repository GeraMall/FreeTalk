#!/usr/bin/env bash
set -euo pipefail
# Run only after the previous primary is fenced and Moscow has been promoted.
test -e /root/trlka-ha/old-primary-fenced
test ! -e /root/trlka-ha/reserve-cloned
test "$(systemctl is-active freetalk-api || true)" != active
test "$(systemctl is-active freetalk-signaling || true)" != active
systemctl stop postgresql@16-main
data=/var/lib/postgresql/16/main
test "$data" = /var/lib/postgresql/16/main
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_controldata "$data" >/dev/null
mv "$data" "/var/lib/postgresql/16/main.pre-moscow-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o postgres -g postgres -m 700 "$data"
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_basebackup \
  -d 'host=10.73.54.1 port=5432 user=trlka_replicator passfile=/var/lib/postgresql/trlka-replication.pgpass application_name=trlka_petersburg connect_timeout=10' \
  -D "$data" -R -X stream -C -S trlka_petersburg --checkpoint=fast --no-password
systemctl unmask postgresql@16-main
systemctl start postgresql@16-main
runuser -u postgres -- psql -Atc 'SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn();'
systemctl disable --now trlka-pg-bootstrap
ufw delete allow in on trlka-ha from 10.73.54.1 to 10.73.54.2 port 5433 proto tcp
touch /root/trlka-ha/reserve-cloned
echo TRLKA_PETERSBURG_STANDBY_READY
