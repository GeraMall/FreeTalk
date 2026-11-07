#!/usr/bin/env bash
set -euo pipefail
# The hardened controller cannot change its Unix UID. Authenticate the already
# privileged local root through PostgreSQL peer mapping, without a DB password
# or a TCP administrator listener. Preserve the normal postgres Unix account.
python3 - <<'PY'
from pathlib import Path
import re
root=Path('/etc/postgresql/16/main')
hba=root/'pg_hba.conf'
text=hba.read_text()
pattern=r'(?m)^local\s+all\s+postgres\s+peer(?:\s+map=trlka_ha_admin)?\s*$'
text,count=re.subn(pattern,'local all postgres peer map=trlka_ha_admin',text)
assert count==1,'Expected exactly one local postgres peer rule'
hba.write_text(text)
ident=root/'pg_ident.conf'
text=ident.read_text()
for user in ('root','postgres'):
    line=f'trlka_ha_admin {user} postgres'
    if line not in text:text+='\n'+line+'\n'
ident.write_text(text)
PY
chown postgres:postgres /etc/postgresql/16/main/pg_hba.conf /etc/postgresql/16/main/pg_ident.conf
chmod 640 /etc/postgresql/16/main/pg_hba.conf /etc/postgresql/16/main/pg_ident.conf
pg_ctlcluster 16 main reload
psql -U postgres -d postgres -AtX -v ON_ERROR_STOP=1 -c 'SELECT pg_is_in_recovery()'
runuser -u postgres -- psql -AtX -v ON_ERROR_STOP=1 -c 'SELECT 1'
