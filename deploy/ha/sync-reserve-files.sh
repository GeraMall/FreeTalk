#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(cat /etc/trlka-ha/role)" = reserve
test "$(runuser -u postgres -- psql -Atc 'SELECT pg_is_in_recovery()')" = t
test "$(systemctl is-active freetalk-api || true)" != active
test "$(systemctl is-active freetalk-signaling || true)" != active
exec 9>/run/lock/trlka-ha-sync.lock
flock -n 9 || exit 0
root=/var/lib/trlka-ha-standby-files
install -d -m 700 "$root"
ssh='ssh -i /root/.ssh/trlka_ha_pull -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/root/.ssh/trlka_ha_known_hosts -o ConnectTimeout=10'
# Download into staging first; a broken transfer never publishes partial application files.
rsync -aH --delete --timeout=120 -e "$ssh" root@10.73.54.1:./ "$root/"
test -s "$root/snapshot-at"
test -s "$root/api/dist/server.js"
test -s "$root/server.bundle.mjs"
rsync -aH --delete "$root/api/" /opt/freetalk/api/
install -o freetalk -g freetalk -m 644 "$root/server.bundle.mjs" /opt/freetalk/server.bundle.mjs
rsync -a --delete "$root/config/" /etc/freetalk/
chmod 700 /etc/freetalk
chmod 600 /etc/freetalk/*
for site in trlka-site freetalk-downloads freetalk-invite; do
  rsync -aH --delete "$root/www/$site/" "/var/www/$site/"
done
chown -R freetalk:freetalk /opt/freetalk/api
chmod 755 /opt/freetalk/api
install -m 600 "$root/Caddyfile.failover" /root/trlka-ha/Caddyfile.failover
# Reuse identical inactive files so the 20 GB reserve does not retain a second
# full copy of all installers. Future rsync updates use rename, never --inplace.
python3 - "$root" <<'PY'
import filecmp
import os
from pathlib import Path
import stat
import sys
root = Path(sys.argv[1])
pairs = [(root/'api',Path('/opt/freetalk/api'))]
pairs += [(root/'www'/name,Path('/var/www')/name) for name in ('trlka-site','freetalk-downloads','freetalk-invite')]
for staged,live in pairs:
    for directory,_,names in os.walk(staged,followlinks=False):
        for name in names:
            source = Path(directory)/name
            target = live/source.relative_to(staged)
            a,b = source.lstat(),target.lstat()
            if not stat.S_ISREG(a.st_mode) or not stat.S_ISREG(b.st_mode): continue
            if (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino): continue
            if (a.st_size,a.st_mtime_ns,a.st_mode,a.st_uid,a.st_gid)!=(b.st_size,b.st_mtime_ns,b.st_mode,b.st_uid,b.st_gid):continue
            if not filecmp.cmp(source,target,shallow=False):continue
            temp=source.with_name(source.name+'.trlka-dedup')
            os.link(target,temp)
            os.replace(temp,source)
PY
echo "TRLKA_STANDBY_FILES_OK snapshot=$(cat "$root/snapshot-at")"
