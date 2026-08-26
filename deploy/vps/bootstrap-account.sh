#!/usr/bin/env bash
set -euo pipefail

install -d -m 700 /etc/freetalk

if [[ ! -s /etc/freetalk/db-password ]]; then
  openssl rand -hex 32 > /etc/freetalk/db-password
  chmod 600 /etc/freetalk/db-password
fi

db_password="$(cat /etc/freetalk/db-password)"
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='freetalk'" | grep -q 1; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 \
    -c "CREATE ROLE freetalk LOGIN PASSWORD '${db_password}'"
fi

if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='freetalk'" | grep -q 1; then
  runuser -u postgres -- createdb -O freetalk freetalk
fi

runuser -u postgres -- psql -d freetalk -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;'

node_root=/opt/node-v22
install -d -m 755 "$node_root"
cd /tmp
curl -fsSLo node-shasums.txt https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
node_archive="$(awk '/linux-x64.tar.xz$/ { print $2; exit }' node-shasums.txt)"
node_hash="$(awk '/linux-x64.tar.xz$/ { print $1; exit }' node-shasums.txt)"
test -n "$node_archive"
test -n "$node_hash"
curl -fsSLo "$node_archive" "https://nodejs.org/dist/latest-v22.x/$node_archive"
printf '%s  %s\n' "$node_hash" "$node_archive" | sha256sum -c -
rm -rf "${node_root:?}"/*
tar -xJf "$node_archive" --strip-components=1 -C "$node_root"

id freetalk >/dev/null 2>&1 || useradd --system --home /var/lib/freetalk --shell /usr/sbin/nologin freetalk
install -d -o freetalk -g freetalk -m 750 /var/lib/freetalk

"$node_root/bin/node" --version
"$node_root/bin/npm" --version
systemctl is-active postgresql freetalk-signaling
