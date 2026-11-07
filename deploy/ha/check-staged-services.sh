#!/usr/bin/env bash
set -euo pipefail
# Disposable database and loopback-only services. No messages or push may leave QA.
if ! pg_lsclusters --no-header | awk '{print $2}' | grep -x trlkaqa >/dev/null; then
  pg_createcluster 16 trlkaqa --port 5434 --start >/dev/null
fi
python3 - <<'PY'
import subprocess
sql = subprocess.check_output(['runuser','-u','postgres','--','psql','-Atc',
    "SELECT 'CREATE ROLE freetalk WITH LOGIN PASSWORD ' || quote_literal(rolpassword) || ';' FROM pg_authid WHERE rolname='freetalk'"], text=True)
exists = subprocess.check_output(['runuser','-u','postgres','--','psql','-p','5434','-Atc',"SELECT 1 FROM pg_roles WHERE rolname='freetalk'"], text=True).strip()
if not exists:
    subprocess.run(['runuser','-u','postgres','--','psql','-p','5434','-v','ON_ERROR_STOP=1'],input=sql,text=True,stdout=subprocess.DEVNULL,check=True)
PY
if ! runuser -u postgres -- psql -p 5434 -Atc "SELECT 1 FROM pg_database WHERE datname='freetalk'" | grep -x 1 >/dev/null; then
  runuser -u postgres -- createdb -p 5434 -O freetalk freetalk
  runuser -u postgres -- pg_dump -Fc freetalk | runuser -u postgres -- pg_restore -p 5434 -d freetalk --exit-on-error
fi
cat > /opt/freetalk/api/ha-qa.mjs <<'EOF'
const url = new URL(process.env.DATABASE_URL);
url.hostname = '127.0.0.1'; url.port = '5434';
process.env.DATABASE_URL = url.toString();
process.env.API_PORT = '18790';
process.env.SIGNALING_INTERNAL_URL = 'http://127.0.0.1:18787';
process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '9';
process.env.FCM_ENABLED = 'false';
delete process.env.SUPPORT_EMAIL;
delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
await import('./dist/server.js');
EOF
chmod 644 /opt/freetalk/api/ha-qa.mjs
cat > /opt/freetalk/ha-qa-signaling.mjs <<'EOF'
process.env.PORT = '18787';
process.env.ACCOUNT_API_URL = 'http://127.0.0.1:18790';
await import('./server.bundle.mjs');
EOF
chmod 644 /opt/freetalk/ha-qa-signaling.mjs
trap 'systemctl stop trlka-qa-api trlka-qa-signaling || true' EXIT
systemd-run --unit trlka-qa-api --property User=freetalk --property Group=freetalk \
  --property EnvironmentFile=/etc/freetalk/api.env --working-directory=/opt/freetalk/api \
  /opt/node-v22/bin/node /opt/freetalk/api/ha-qa.mjs
systemd-run --unit trlka-qa-signaling --property User=freetalk --property Group=freetalk \
  --property EnvironmentFile=/etc/freetalk/signaling.env \
  --working-directory=/opt/freetalk /opt/node-v22/bin/node /opt/freetalk/ha-qa-signaling.mjs
for attempt in {1..20}; do
  if curl -fsS http://127.0.0.1:18790/health && curl -fsS http://127.0.0.1:18787/health; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:18790/health
curl --fail --silent http://127.0.0.1:18787/health
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18790/v1/me)" = 401
echo TRLKA_STAGED_SERVICES_SMOKE_OK
