#!/usr/bin/env bash
set -euo pipefail
test -s /root/trlka-ha/staging/Caddyfile.primary
test -d /root/trlka-ha/staging/caddy/.local/share/caddy
test -s /var/www/trlka-site/app/index.html
caddy validate --config /root/trlka-ha/staging/Caddyfile.primary >/dev/null
cp -a /etc/caddy/Caddyfile /root/trlka-ha/Caddyfile.initial
systemctl stop caddy
cp -a /root/trlka-ha/staging/caddy/. /var/lib/caddy/
chown -R caddy:caddy /var/lib/caddy
install -o root -g caddy -m 644 /root/trlka-ha/staging/Caddyfile.primary /etc/caddy/Caddyfile
ufw allow in on trlka-ha from 10.73.54.2 to 10.73.54.1 port 18080 proto tcp comment 'TRLKA compatibility gateway'
systemctl start caddy
curl --fail --silent --output /dev/null --resolve trlka.com:443:127.0.0.1 https://trlka.com/app/
echo TRLKA_PRIMARY_HTTPS_READY
