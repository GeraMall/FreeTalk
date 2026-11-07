#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(cat /etc/trlka-ha/role)" = primary
test "$(runuser -u postgres -- psql -Atc 'SELECT pg_is_in_recovery()')" = f
exec 9>/run/lock/trlka-ha-export.lock
flock -n 9 || exit 0
root=/var/lib/trlka-ha-export
install -d -m 700 "$root" "$root/www" "$root/config" "$root/caddy"
# Hard links keep the export cheap. rsync's normal rename behavior preserves live files.
rsync -aH --delete --link-dest=/opt/freetalk/api/ /opt/freetalk/api/ "$root/api/"
rsync -a /opt/freetalk/server.bundle.mjs "$root/"
rsync -a --delete /etc/freetalk/ "$root/config/"
for site in trlka-site freetalk-downloads freetalk-invite; do
  rsync -aH --delete --link-dest="/var/www/$site/" "/var/www/$site/" "$root/www/$site/"
done
rsync -a --delete /var/lib/caddy/ "$root/caddy/"
python3 - "$root" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
text = Path('/etc/caddy/Caddyfile').read_text()
marker = 'http://:18080 {'
assert text.count(marker) == 1
text = text[:text.index(marker)].replace('header X-Trlka-Node moscow','header X-Trlka-Node petersburg')
# Preserve the reserve's unrelated CrossInk/Golosom proxy sites.
previous = Path('/root/trlka-ha/staging/Caddyfile.production').read_text()
begin, end = previous.index('# CrossInk '), previous.index('# Public Trlka ')
text += '\n' + previous[begin:end] + '\n'
(root / 'Caddyfile.failover').write_text(text)
PY
caddy adapt --config "$root/Caddyfile.failover" --validate >/dev/null 2>&1
python3 /usr/local/lib/trlka-ha/snapshot_manifest.py create "$root"
date -u +%Y-%m-%dT%H:%M:%SZ > "$root/snapshot-at"
echo TRLKA_STANDBY_EXPORT_OK
