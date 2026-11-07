#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
test "$(hostname -I | tr ' ' '\n' | grep -x '185.225.201.129')" = '185.225.201.129'
if ! id freetalk >/dev/null 2>&1; then
  useradd --system --home /var/lib/freetalk --shell /usr/sbin/nologin freetalk
fi
install -d -o freetalk -g freetalk -m 750 /var/lib/freetalk
install -d -m 700 /root/trlka-ha/staging
curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
  gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl --fail --silent --show-error --location https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy
caddy version
echo TRLKA_STAGE_HOST_READY
