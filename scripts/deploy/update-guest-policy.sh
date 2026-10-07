#!/usr/bin/env bash
# Apply only the guest quota; leave signaling and existing calls running.
set -euo pipefail
current=/opt/freetalk/api/dist/policy.js
node=/opt/node-v22/bin/node
test -f "$current"
stage=$(mktemp -d /opt/freetalk/guest-policy-XXXXXXXX)
backup="$stage/policy.before.js"
candidate="$stage/policy.mjs"
cp -a "$current" "$backup"
"$node" --input-type=module - "$current" "$candidate" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [current, candidate] = process.argv.slice(2);
const original = readFileSync(current, 'utf8');
if (!original.includes('export const GUEST_MAX_JOINS_PER_UTC_DAY = 5;') ||
    !original.includes('export const GUEST_SESSION_SECONDS = 30 * 60;')) {
  throw new Error('Unexpected existing policy; no live file was changed');
}
const updated = original
  .replace('export const GUEST_MAX_JOINS_PER_UTC_DAY = 5;', 'export const GUEST_MAX_JOINS_PER_UTC_DAY = 2;')
  .replace('export const GUEST_SESSION_SECONDS = 30 * 60;', 'export const GUEST_SESSION_SECONDS = 3 * 60 * 60;');
writeFileSync(candidate, updated, { flag: 'wx', mode: 0o644 });
const policy = await import(pathToFileURL(candidate).href);
if (policy.GUEST_SESSION_SECONDS !== 10800 || policy.GUEST_MAX_JOINS_PER_UTC_DAY !== 2 ||
    !policy.guestQuotaAvailable(0) || !policy.guestQuotaAvailable(1) ||
    policy.guestQuotaAvailable(2) || policy.guestQuotaAvailable(-1)) {
  throw new Error('Candidate policy validation failed');
}
NODE
rollback() {
  cp -a "$backup" "$current"
  systemctl restart freetalk-api
  echo "Guest policy rolled back. Backup: $backup" >&2
}
trap rollback ERR
install -o freetalk -g freetalk -m 0644 "$candidate" "$current.next"
mv "$current.next" "$current"
systemctl restart freetalk-api
healthy=false
for _ in $(seq 1 20); do
  if curl --max-time 2 -fsS http://127.0.0.1:8790/health > "$stage/health.json"; then
    healthy=true
    break
  fi
  sleep 0.5
done
test "$healthy" = true
"$node" --input-type=module -e "import {GUEST_MAX_JOINS_PER_UTC_DAY as joins,GUEST_SESSION_SECONDS as seconds} from '/opt/freetalk/api/dist/policy.js'; if(joins!==2||seconds!==10800) process.exit(1); console.log(JSON.stringify({joins,seconds}));"
trap - ERR
cat "$stage/health.json"
printf '\nGuest policy deployed; backup: %s\n' "$backup"
