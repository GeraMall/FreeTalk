#!/bin/sh
# Install only the relay. Does not restart API/signaling, change DNS or touch HA.
set -eu
ip=${1:?public IPv4 required}
case "$ip" in 185.225.201.129|191.44.38.60) ;; *) echo 'Unexpected relay address' >&2; exit 1;; esac
if command -v turnserver >/dev/null 2>&1; then
  grep -q '^# TRLKA managed authenticated TURN' /etc/turnserver.conf || { echo 'Existing TURN is not managed by this installer' >&2; exit 1; }
fi
install -d -m 700 /etc/trlka-turn
if [ ! -s /etc/trlka-turn/shared-secret ]; then
  umask 077
  openssl rand -hex 48 > /etc/trlka-turn/shared-secret
fi
if ! command -v turnserver >/dev/null 2>&1; then
  systemctl mask coturn.service
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends coturn
fi
secret=$(cat /etc/trlka-turn/shared-secret)
umask 077
cat > /etc/turnserver.conf <<EOF
# TRLKA managed authenticated TURN
listening-port=3478
listening-ip=$ip
relay-ip=$ip
min-port=49160
max-port=49671
realm=turn.trlka.com
fingerprint
use-auth-secret
static-auth-secret=$secret
no-tls
no-dtls
no-tcp-relay
no-cli
no-multicast-peers
no-software-attribute
stale-nonce=600
user-quota=16
total-quota=256
max-bps=3000000
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
log-file=syslog
simple-log
EOF
chown root:turnserver /etc/turnserver.conf
chmod 640 /etc/turnserver.conf
install -d -m 755 /etc/systemd/system/coturn.service.d
cat > /etc/systemd/system/coturn.service.d/trlka.conf <<'EOF'
[Service]
MemoryMax=256M
TasksMax=128
NoNewPrivileges=true
ProtectHome=true
EOF
systemctl unmask coturn.service
systemctl daemon-reload
systemctl enable --now coturn.service
ufw allow 3478/udp comment 'TRLKA authenticated TURN'
ufw allow 3478/tcp comment 'TRLKA authenticated TURN TCP fallback'
ufw allow 49160:49671/udp comment 'TRLKA bounded TURN relay range'
systemctl is-active coturn.service
