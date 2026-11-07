#!/usr/bin/env bash
set -euo pipefail
test -s /root/trlka-ha/replication-password
# The existing database keeps its loopback listener until the controlled cutover.
python3 - <<'PY'
from pathlib import Path
import subprocess
p = Path('/root/trlka-ha/replication-password').read_text().strip()
assert len(p) == 64 and all(c in '0123456789abcdef' for c in p)
exists = subprocess.check_output(['runuser','-u','postgres','--','psql','-Atc',"SELECT 1 FROM pg_roles WHERE rolname='trlka_replicator'"], text=True).strip()
verb = 'ALTER' if exists else 'CREATE'
sql = f"{verb} ROLE trlka_replicator WITH LOGIN REPLICATION PASSWORD '{p}';\nALTER SYSTEM SET max_slot_wal_keep_size = '256MB';\nSELECT pg_reload_conf();\n"
subprocess.run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1'], input=sql, text=True, stdout=subprocess.DEVNULL, check=True)
hba = Path('/etc/postgresql/16/main/pg_hba.conf')
line = 'host replication trlka_replicator 127.0.0.1/32 scram-sha-256'
text = hba.read_text()
if line not in text:
    hba.write_text(text + '\n# TRLKA bootstrap over the private WireGuard bridge\n' + line + '\n')
subprocess.run(['pg_ctlcluster','16','main','reload'], check=True)
PY
cat > /etc/systemd/system/trlka-pg-bootstrap.service <<'EOF'
[Unit]
Description=TRLKA private PostgreSQL bootstrap bridge
Requires=wg-quick@trlka-ha.service postgresql@16-main.service
After=wg-quick@trlka-ha.service postgresql@16-main.service
[Service]
User=nobody
ExecStart=/usr/bin/socat TCP4-LISTEN:5433,bind=10.73.54.2,reuseaddr,fork TCP4:127.0.0.1:5432
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
ufw allow in on trlka-ha from 10.73.54.1 to 10.73.54.2 port 5433 proto tcp comment 'TRLKA private DB bootstrap'
systemctl daemon-reload
systemctl enable --now trlka-pg-bootstrap
systemctl is-active trlka-pg-bootstrap
echo TRLKA_REPLICATION_SOURCE_READY
