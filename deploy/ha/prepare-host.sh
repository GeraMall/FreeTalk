#!/usr/bin/env bash
set -euo pipefail

role="${1:?expected primary or reserve}"
case "$role" in
  primary) peer=191.44.38.60 ;;
  reserve) peer=185.225.201.129 ;;
  *) exit 2 ;;
esac

install -d -m 700 /root/trlka-ha /etc/wireguard
export DEBIAN_FRONTEND=noninteractive
if [[ "$role" == reserve ]]; then
  apt-get update -qq
  apt-get install -y -qq wireguard-tools socat rsync
fi
if [[ ! -s /etc/wireguard/trlka-ha.key ]]; then
  (umask 077; wg genkey > /etc/wireguard/trlka-ha.key)
fi
chmod 600 /etc/wireguard/trlka-ha.key
ufw allow from "$peer" to any port 51820 proto udp comment 'TRLKA private replication'

if [[ "$role" == primary ]]; then
  test -s /root/.ssh/authorized_keys
  # OpenSSH uses the first value encountered. This must precede provider drop-ins.
  cat > /etc/ssh/sshd_config.d/00-00-trlka-key-only.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
  /usr/sbin/sshd -t
  effective_ssh="$(/usr/sbin/sshd -T)"
  grep -qx 'passwordauthentication no' <<<"$effective_ssh"
  grep -qx 'permitrootlogin without-password' <<<"$effective_ssh"
  systemctl reload ssh
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw default deny incoming
  ufw default allow outgoing
  ufw --force enable
  cat > /etc/fail2ban/jail.d/trlka-sshd.local <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 6
findtime = 10m
bantime = 1h
EOF
  systemctl enable --now fail2ban
  systemctl restart fail2ban
  if ! swapon --show=NAME --noheadings | grep -q .; then
    test ! -e /swapfile
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
fi
echo "TRLKA_HOST_PREPARED=$role"
