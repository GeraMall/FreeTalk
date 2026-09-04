#!/usr/bin/env bash
set -euo pipefail
artifact=${1:?artifact required}
stamp=${2:-$(date -u +%Y%m%dT%H%M%SZ)}
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]
stage="/opt/freetalk/api-push-stage-$stamp"
backup="/opt/freetalk/api-pre-push-$stamp"
unit="freetalk-api-push-check-${stamp,,}"
dropin=/etc/systemd/system/freetalk-api.service.d/android-push.conf
test -f "$artifact"
test ! -e "$dropin"
if [[ $# -lt 2 ]]; then
test ! -e "$stage"
test -f /root/trlka-push-upload.json
install -o root -g root -m 600 /root/trlka-push-upload.json /etc/freetalk/trlka-push.json
install -d -m 700 /var/backups/freetalk
runuser -u postgres -- pg_dump -Fc freetalk > "/var/backups/freetalk/pre-push-$stamp.dump"
chmod 600 "/var/backups/freetalk/pre-push-$stamp.dump"
cp -a /opt/freetalk/api "$stage"
tar -xzf "$artifact" -C "$stage"
export PATH=/opt/node-v22/bin:$PATH
cd "$stage"
npm install --omit=dev --ignore-scripts --no-audit --no-fund
else
test -d "$stage/node_modules/firebase-admin"
test -s "/var/backups/freetalk/pre-push-$stamp.dump"
fi
chown -R freetalk:freetalk "$stage"
systemd-run --quiet --wait --pipe --unit="$unit-migrate" -p User=freetalk -p Group=freetalk -p WorkingDirectory="$stage" -p EnvironmentFile=/etc/freetalk/api.env /opt/node-v22/bin/node "$stage/dist/migrate.js"
systemd-run --quiet --unit="$unit" -p User=freetalk -p Group=freetalk -p WorkingDirectory="$stage" -p EnvironmentFile=/etc/freetalk/api.env /usr/bin/env API_PORT=8791 FCM_ENABLED=false /opt/node-v22/bin/node "$stage/dist/server.js"
ok=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8791/health 2>/dev/null | grep -Fq '"version":"0.4.0-beta.19"'; then ok=true; break; fi
  sleep 1
done
systemctl stop "$unit" || true
if [[ "$ok" != true ]]; then echo "Rehearsal failed; production unchanged"; exit 1; fi
install -d -m 755 /etc/systemd/system/freetalk-api.service.d
cat > "$dropin" <<'EOF'
[Service]
LoadCredential=trlka-push.json:/etc/freetalk/trlka-push.json
Environment=GOOGLE_APPLICATION_CREDENTIALS=/run/credentials/freetalk-api.service/trlka-push.json
Environment=FCM_PROJECT_ID=trlka-b5d34
Environment=FCM_ENABLED=true
EOF
systemctl stop freetalk-api
mv /opt/freetalk/api "$backup"
mv "$stage" /opt/freetalk/api
systemctl daemon-reload
systemctl start freetalk-api || true
ok=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8790/health 2>/dev/null | grep -Fq '"version":"0.4.0-beta.19"'; then ok=true; break; fi
  sleep 1
done
if [[ "$ok" != true ]]; then
  systemctl stop freetalk-api || true
  mv /opt/freetalk/api "/opt/freetalk/api-push-failed-$stamp"
  mv "$backup" /opt/freetalk/api
  mv "$dropin" "/root/android-push-disabled-$stamp.conf"
  systemctl daemon-reload
  systemctl start freetalk-api
  echo "Rolled back API; additive migration retained"
  exit 1
fi
echo "DEPLOYED beta.19; rollback=$backup; database=/var/backups/freetalk/pre-push-$stamp.dump"
