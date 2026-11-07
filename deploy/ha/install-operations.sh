#!/usr/bin/env bash
set -euo pipefail
role="${1:?primary or reserve}"
case "$role" in primary) keep=7 ;; reserve) keep=3 ;; *) exit 2 ;; esac
test -x /root/trlka-ha/backup.sh
test -x /root/trlka-ha/monitor.sh
install -d -m 755 /etc/trlka-ha
printf '%s\n' "$role" > /etc/trlka-ha/role
if [[ "$role" == primary ]]; then
  # PostgreSQL and Caddy bind the private WireGuard address. Avoid a boot race
  # where they start before the address exists and lose replication/proxy traffic.
  for service in postgresql@16-main caddy; do
    install -d -m 755 "/etc/systemd/system/$service.service.d"
    cat > "/etc/systemd/system/$service.service.d/96-ha-network.conf" <<'EOF'
[Unit]
Requires=wg-quick@trlka-ha.service
After=wg-quick@trlka-ha.service
EOF
  done
fi
install -m 755 /root/trlka-ha/backup.sh /usr/local/sbin/trlka-ha-backup
install -m 755 /root/trlka-ha/monitor.sh /usr/local/sbin/trlka-ha-monitor
cat > /usr/local/sbin/trlka-ha-primary-condition <<'EOF'
#!/bin/sh
set -eu
test "$(cat /etc/trlka-ha/role)" = primary
test "$(psql -U freetalk -d freetalk -Atc 'SELECT pg_is_in_recovery()')" = f
if test -e /etc/trlka-ha/automatic-enabled; then
  exec python3 /usr/local/lib/trlka-ha/primary_guard.py
fi
EOF
chmod 755 /usr/local/sbin/trlka-ha-primary-condition
for service in freetalk-api freetalk-signaling; do
  install -d -m 755 "/etc/systemd/system/$service.service.d"
  cat > "/etc/systemd/system/$service.service.d/95-ha-role.conf" <<'EOF'
[Unit]
After=postgresql@16-main.service wg-quick@trlka-ha.service
Requires=postgresql@16-main.service
[Service]
ExecCondition=/usr/local/sbin/trlka-ha-primary-condition
EOF
done
cat > /etc/systemd/system/trlka-ha-backup.service <<EOF
[Unit]
Description=TRLKA PostgreSQL daily backup
After=postgresql@16-main.service
[Service]
Type=oneshot
Environment=TRLKA_BACKUP_KEEP=$keep
ExecStart=/usr/local/sbin/trlka-ha-backup
UMask=0077
Nice=10
IOSchedulingClass=idle
EOF
cat > /etc/systemd/system/trlka-ha-backup.timer <<'EOF'
[Unit]
Description=TRLKA daily database backups
[Timer]
OnCalendar=*-*-* 03:15:00 UTC
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/trlka-ha-monitor.service <<'EOF'
[Unit]
Description=TRLKA replication and service health check
After=network-online.target postgresql@16-main.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/trlka-ha-monitor
EOF
cat > /etc/systemd/system/trlka-ha-monitor.timer <<'EOF'
[Unit]
Description=TRLKA health check every minute
[Timer]
OnBootSec=2m
OnUnitActiveSec=1m
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now trlka-ha-backup.timer trlka-ha-monitor.timer
systemctl start trlka-ha-backup.service trlka-ha-monitor.service
echo "TRLKA_OPERATIONS_READY=$role"
