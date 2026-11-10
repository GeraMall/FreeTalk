#!/bin/sh
# Primary: allow-reconnect requires the owner's explicit approval for this run.
# Standby: installs files only; never starts or promotes the application.
set -eu
expected_sha=${1:?expected bundle checksum required}
reconnect=${2:-idle-only}
node=/opt/node-v22/bin/node
staged=/root/trlka-turn-pending/server.bundle.mjs
actual_sha=$(sha256sum "$staged" | cut -d' ' -f1)
[ "$actual_sha" = "$expected_sha" ] || { echo 'Bundle checksum mismatch' >&2; exit 1; }
active=false
if systemctl is-active --quiet freetalk-signaling; then
  active=true
  if [ "$reconnect" != allow-reconnect ]; then
    "$node" --env-file=/etc/freetalk/signaling.env --input-type=module <<'JS'
const r=await fetch('http://127.0.0.1:8787/internal/active-rooms',{headers:{'x-freetalk-internal-secret':process.env.INTERNAL_SIGNALING_SECRET}});
if(!r.ok) process.exit(1);
const data=await r.json(); if(!Array.isArray(data.roomIds)||data.roomIds.length) process.exit(2);
JS
  fi
fi
backup=/root/trlka-ha/local-turn-$(date -u +%Y%m%dT%H%M%S)
install -d -m 700 "$backup"
cp -a /opt/freetalk/server.bundle.mjs "$backup/server.bundle.mjs"
if [ -f /etc/freetalk/turn-local.env ]; then cp -a /etc/freetalk/turn-local.env "$backup/turn-local.env"; fi
"$node" --input-type=module <<'JS'
import fs from 'node:fs';
import os from 'node:os';
const key=fs.readFileSync('/etc/trlka-turn/shared-secret','utf8').trim();
if(!/^[0-9a-f]{96}$/.test(key)) throw Error('Invalid local relay key');
const urls=['185.225.201.129','191.44.38.60'].flatMap(ip=>['udp','tcp'].map(t=>`turn:${ip}:3478?transport=${t}`));
const moscow=Object.values(os.networkInterfaces()).flat().some(i=>i?.address==='185.225.201.129');
fs.writeFileSync('/etc/freetalk/turn-local.env',`LOCAL_TURN_URLS=${urls.join(',')}\nLOCAL_TURN_SECRET=${key}\nSIGNALING_LOCATION=${moscow?'VPS-MSK':'VPS-SPB'}\n`,{mode:0o600});
fs.chmodSync('/etc/freetalk/turn-local.env',0o600);
JS
install -d -m 755 /etc/systemd/system/freetalk-signaling.service.d
cat > /etc/systemd/system/freetalk-signaling.service.d/45-local-turn.conf <<'EOF'
[Service]
EnvironmentFile=/etc/freetalk/turn-local.env
EOF
install -m 644 -o freetalk -g freetalk "$staged" /opt/freetalk/server.bundle.mjs.next
mv /opt/freetalk/server.bundle.mjs.next /opt/freetalk/server.bundle.mjs
systemctl daemon-reload
if [ "$active" = true ]; then
  if ! systemctl restart freetalk-signaling; then
    cp -a "$backup/server.bundle.mjs" /opt/freetalk/server.bundle.mjs
    systemctl restart freetalk-signaling || true
    echo 'Signaling restart failed; bundle rolled back' >&2
    exit 1
  fi
  sleep 1
  curl -fsS http://127.0.0.1:8787/health
else
  echo 'Standby files updated; application remains stopped'
fi
echo "Backup: $backup"
