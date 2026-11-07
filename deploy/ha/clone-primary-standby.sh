#!/usr/bin/env bash
set -euo pipefail
test -s /var/lib/postgresql/trlka-replication.pgpass
test ! -e /root/trlka-ha/primary-cloned
systemctl stop postgresql@16-main
data=/var/lib/postgresql/16/main
test "$data" = /var/lib/postgresql/16/main
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_controldata "$data" >/dev/null
mv "$data" "/var/lib/postgresql/16/main.initial-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o postgres -g postgres -m 700 "$data"
runuser -u postgres -- /usr/lib/postgresql/16/bin/pg_basebackup \
  -d 'host=10.73.54.2 port=5433 user=trlka_replicator passfile=/var/lib/postgresql/trlka-replication.pgpass application_name=trlka_moscow connect_timeout=10' \
  -D "$data" -R -X stream -C -S trlka_moscow --checkpoint=spread --no-password
cat > /etc/postgresql/16/main/conf.d/trlka-ha.conf <<'EOF'
listen_addresses = '127.0.0.1,10.73.54.1'
max_slot_wal_keep_size = '512MB'
hot_standby = on
EOF
printf '\n# TRLKA private standby\nhost replication trlka_replicator 10.73.54.2/32 scram-sha-256\n' >> /etc/postgresql/16/main/pg_hba.conf
ufw allow in on trlka-ha from 10.73.54.2 to 10.73.54.1 port 5432 proto tcp comment 'TRLKA private DB replication'
systemctl start postgresql@16-main
runuser -u postgres -- psql -Atc 'SELECT pg_is_in_recovery(), pg_last_wal_replay_lsn();'
touch /root/trlka-ha/primary-cloned
echo TRLKA_PRIMARY_STANDBY_READY
