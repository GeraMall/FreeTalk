#!/usr/bin/env bash
set -euo pipefail
archive=${1:?Pass the cluster archive}
expected=${2:?Pass its reviewed SHA-256}
test "$(id -u)" = 0
test -f /etc/trlka/cluster.env
test "$(stat -c %a /etc/trlka/cluster.env)" = 600
test "$(stat -c %U /etc/trlka/cluster.env)" = root
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]]
test "$(sha256sum "$archive" | cut -d' ' -f1)" = "${expected,,}"
node=/opt/node-v22/bin/node
test -x "$node"
"$node" -e 'if(Number(process.versions.node.split(".")[0])<22)process.exit(1)'
id freetalk >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin freetalk
set -a
source /etc/trlka/cluster.env
set +a
[[ "$SIGNALING_NODE_ID" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]
if test -f /opt/trlka-cluster/current/cluster-admin.mjs; then
  "$node" /opt/trlka-cluster/current/cluster-admin.mjs assert-empty "$SIGNALING_NODE_ID"
fi
release="/opt/trlka-cluster/releases/${expected,,}"
mkdir -p "$release"
tar -xzf "$archive" -C "$release"
"$node" --check "$release/server.mjs"
"$node" --check "$release/gateway.mjs"
"$node" "$release/cluster-admin.mjs" status
chown -R root:root "$release"
chmod -R go-w "$release"
ln -sfn "$release" /opt/trlka-cluster/current.next
mv -Tf /opt/trlka-cluster/current.next /opt/trlka-cluster/current
install -m 644 "$release/trlka-voice.service" /etc/systemd/system/trlka-voice.service
install -m 644 "$release/trlka-room-gateway.service" /etc/systemd/system/trlka-room-gateway.service
systemctl daemon-reload
systemctl enable trlka-voice trlka-room-gateway
systemctl restart trlka-voice trlka-room-gateway
ready=false
for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 2 "http://${SIGNALING_HOST}:${PORT}/ready" >/dev/null; then ready=true;break;fi
  sleep 1
done
test "$ready" = true || { journalctl -u trlka-voice --no-pager -n 20; exit 1; }
"$node" "$release/cluster-admin.mjs" status
echo 'Node ready. Review the room cap and explicitly resume a previously drained node.'
