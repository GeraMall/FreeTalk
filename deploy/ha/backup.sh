#!/usr/bin/env bash
set -euo pipefail
umask 077
root=/var/backups/trlka-ha
install -d -m 700 "$root"
exec 9>/run/lock/trlka-ha-backup.lock
flock -n 9 || exit 0
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$root/freetalk-$stamp.dump.partial"
runuser -u postgres -- pg_dump --format=custom --dbname=freetalk > "$tmp"
runuser -u postgres -- pg_restore --list < "$tmp" >/dev/null
mv "$tmp" "$root/freetalk-$stamp.dump"
runuser -u postgres -- pg_dumpall --globals-only > "$root/roles-$stamp.sql"
sha256sum "$root/freetalk-$stamp.dump" > "$root/freetalk-$stamp.sha256"
python3 - "$root" "${TRLKA_BACKUP_KEEP:-7}" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve()
assert str(root) == '/var/backups/trlka-ha'
keep = int(sys.argv[2]); assert 2 <= keep <= 30
backups = sorted(root.glob('freetalk-*.dump'), reverse=True)
for old in backups[keep:]:
    stamp = old.name.removeprefix('freetalk-').removesuffix('.dump')
    for name in (old.name, f'roles-{stamp}.sql', f'freetalk-{stamp}.sha256'):
        path = root / name
        assert path.resolve().parent == root
        path.unlink(missing_ok=True)
print(f'TRLKA_BACKUP_OK retained={min(len(backups),keep)}')
PY
