#!/usr/bin/env bash
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${TRLKA_COURSE_LAB:-}" == isolated-ci && $EUID == 0 ]]
umask 022
out="$PWD/output/coursework-operations"
install -d -m 755 "$out"
scratch="$(mktemp -d /var/tmp/trlka-operations.XXXXXXXX)"
chmod 755 "$scratch"
pg=/usr/lib/postgresql/16/bin
client=trlka-ops-client
server=trlka-ops-server
unit=trlka-course-ops
cleanup() {
  systemctl stop "$unit.timer" "$unit.service" 2>/dev/null || true
  runuser -u postgres -- "$pg/pg_ctl" -D "$scratch/db" -m fast stop >/dev/null 2>&1 || true
  for ns in "$client" "$server"; do
    for pid in $(ip netns pids "$ns" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
    ip netns del "$ns" 2>/dev/null || true
  done
  rm -rf -- "$scratch"
}
trap cleanup EXIT
exec > >(tee "$out/results.txt") 2>&1
echo 'TRLKA OPERATIONS AND RECOVERY LAB'
date -u +%FT%TZ
"$pg/pg_dump" --version
pass() { printf 'PASS %s\n' "$*"; }
trap 'printf "FAIL line=%s\n" "$LINENO"' ERR

ip netns add "$client"
ip netns add "$server"
ip link add tlop1 type veth peer name tlop2
ip link set tlop1 netns "$client"
ip link set tlop2 netns "$server"
ip -n "$client" addr add 10.223.0.1/24 dev tlop1
ip -n "$server" addr add 10.223.0.2/24 dev tlop2
for ns in "$client" "$server"; do ip -n "$ns" link set lo up; done
ip -n "$client" link set tlop1 up
ip -n "$server" link set tlop2 up
(umask 077; wg genkey > "$scratch/client.key"; wg genkey > "$scratch/server.key")
client_pub="$(wg pubkey < "$scratch/client.key")"
server_pub="$(wg pubkey < "$scratch/server.key")"
for ns in "$client" "$server"; do ip -n "$ns" link add wg-course type wireguard; done
ip netns exec "$client" wg set wg-course private-key "$scratch/client.key" peer "$server_pub" allowed-ips 10.223.1.2/32 endpoint 10.223.0.2:51832
ip netns exec "$server" wg set wg-course listen-port 51832 private-key "$scratch/server.key" peer "$client_pub" allowed-ips 10.223.1.1/32
ip -n "$client" addr add 10.223.1.1/24 dev wg-course
ip -n "$server" addr add 10.223.1.2/24 dev wg-course
for ns in "$client" "$server"; do ip -n "$ns" link set wg-course up; done
install -d -m 755 "$scratch/www"
ip netns exec "$server" python3 -m http.server 18081 --bind 10.223.1.2 --directory "$scratch/www" > "$scratch/http.log" 2>&1 &
health_pid=$!
printf 'ready\n' > "$scratch/www/health"
probe=(ip netns exec "$client" curl -fsS --max-time 2 http://10.223.1.2:18081/health)
for attempt in {1..8}; do "${probe[@]}" > "$scratch/reply" 2>/dev/null && break; sleep 1; done
test "$(cat "$scratch/reply")" = ready
ip netns exec "$client" wg show wg-course latest-handshakes | awk '$2>0{ok=1} END{exit !ok}'
pass '01 WireGuard handshake and private HTTP probe'
if ip netns exec "$client" curl -fsS --max-time 2 http://10.223.0.2:18081/health 2>/dev/null; then exit 1; fi
test -z "$(ip -n "$client" route show default)"
pass '02 Service unavailable on underlay address'

cat > "$scratch/check.sh" <<'EOF'
#!/usr/bin/env bash
set -eu
if ip netns exec trlka-ops-client curl -fsS --max-time 2 http://10.223.1.2:18081/health >/dev/null 2>&1; then
  echo 'COURSE_HEALTH_OK'
else
  echo 'COURSE_HEALTH_FAILED'
  exit 1
fi
EOF
systemd-run --unit="$unit" --on-active=2s --timer-property=AccuracySec=1s --remain-after-exit /bin/bash "$scratch/check.sh"
for attempt in {1..15}; do
  journalctl -u "$unit.service" -o cat --no-pager | grep '^COURSE_HEALTH_OK$' > "$out/health-journal.txt" && break
  sleep 1
done
grep -qx COURSE_HEALTH_OK "$out/health-journal.txt"
pass '03 systemd timer ran probe and journal recorded success'
kill "$health_pid"
wait "$health_pid" 2>/dev/null || true
if systemctl restart "$unit.service"; then exit 1; fi
test "$(systemctl show "$unit.service" -p ExecMainStatus --value)" = 1
for attempt in {1..10}; do
  journalctl -u "$unit.service" -o cat --no-pager | grep '^COURSE_HEALTH_' > "$out/health-journal.txt"
  grep -qx COURSE_HEALTH_FAILED "$out/health-journal.txt" && break
  sleep 1
done
grep -qx COURSE_HEALTH_FAILED "$out/health-journal.txt"
pass '04 Stopped service detected and failure recorded'

install -d -m 700 -o postgres -g postgres "$scratch/db" "$scratch/socket"
runuser -u postgres -- "$pg/initdb" -D "$scratch/db" --auth-local=peer --auth-host=scram-sha-256 >/dev/null
runuser -u postgres -- "$pg/pg_ctl" -D "$scratch/db" -o "-h '' -k $scratch/socket" -l "$scratch/db/postgresql.log" -w start >/dev/null
as_pg() {
  local tool=$1
  shift
  runuser -u postgres -- env PGHOST="$scratch/socket" "$pg/$tool" "$@"
}
as_pg createdb course_source
as_pg psql -X -v ON_ERROR_STOP=1 course_source >/dev/null <<'SQL'
CREATE TABLE rooms (id integer PRIMARY KEY, title text NOT NULL);
CREATE TABLE events (
  id integer PRIMARY KEY, room_id integer NOT NULL REFERENCES rooms(id),
  body text NOT NULL
);
INSERT INTO rooms VALUES (1, 'classroom'), (2, 'test room');
INSERT INTO events VALUES (1, 1, 'fixture A'), (2, 1, 'fixture B'), (3, 2, 'fixture C');
SQL
install -d -m 700 "$scratch/backups" "$scratch/backups/.staging"
pack="$scratch/backups/.staging"
(umask 077; as_pg pg_dump -Fc course_source > "$pack/database.dump")
as_pg pg_restore --list < "$pack/database.dump" > /dev/null
pass '05 PostgreSQL custom archive created and catalog readable'

test ! -d "$scratch/backups/current"
if (cd "$pack"; sha256sum -c SHA256SUMS >/dev/null 2>&1); then exit 1; fi
pass '06 Incomplete backup detected before publication'
(umask 077; cd "$pack"; sha256sum database.dump > SHA256SUMS; sha256sum -c SHA256SUMS)
mv "$pack" "$scratch/backups/current"
pack="$scratch/backups/current"
test "$(stat -c %a "$pack/database.dump")" = 600
if runuser -u nobody -- test -r "$pack/database.dump"; then exit 1; fi
pass '07 Verified package published with restricted permissions'

install -d -m 700 "$scratch/damaged"
cp "$pack/database.dump" "$pack/SHA256SUMS" "$scratch/damaged/"
printf 'tamper\n' >> "$scratch/damaged/database.dump"
if (cd "$scratch/damaged"; sha256sum -c SHA256SUMS >/dev/null 2>&1); then exit 1; fi
pass '08 Deliberately damaged synthetic copy rejected by checksum'

as_pg createdb course_restored
start="$(date +%s%3N)"
as_pg pg_restore --exit-on-error --single-transaction --dbname=course_restored < "$pack/database.dump"
elapsed="$(( $(date +%s%3N) - start ))"
query="SELECT count(*), md5(string_agg(concat_ws('|', e.id, r.id, r.title, e.body), E'\\n' ORDER BY e.id)) FROM events e JOIN rooms r ON r.id=e.room_id"
before="$(as_pg psql -XAt -v ON_ERROR_STOP=1 -c "$query" course_source)"
after="$(as_pg psql -XAt -v ON_ERROR_STOP=1 -c "$query" course_restored)"
test "$before" = "$after"
test "${after%%|*}" = 3
printf 'fixture_rows=3\nrestore_ms=%s\n' "$elapsed" > "$out/restore.txt"
pass '09 Restore into empty database reproduced three joined rows'
if as_pg psql -X -v ON_ERROR_STOP=1 -c "INSERT INTO events VALUES (4, 999, 'orphan')" course_restored > /dev/null 2>&1; then exit 1; fi
pass '10 Restored foreign key rejected orphan row'

disk_state() {
  local percent=$1 free_mib=$2
  if (( free_mib <= 512 )); then echo critical
  elif (( percent >= 85 || free_mib < 2048 )); then echo warning
  else echo ok
  fi
}
{
  for sample in '35 4096 ok' '97 697 warning' '60 512 critical' '85 2048 warning'; do
    read -r percent free expected <<< "$sample"
    actual="$(disk_state "$percent" "$free")"
    test "$actual" = "$expected"
    printf 'used=%s%% free_mib=%s state=%s\n' "$percent" "$free" "$actual"
  done
} > "$out/disk-policy.txt"
pass '11 Revised disk policy detected low space and boundary cases'
