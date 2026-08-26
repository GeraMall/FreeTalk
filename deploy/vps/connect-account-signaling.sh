#!/usr/bin/env bash
set -euo pipefail

env_file=/etc/freetalk/signaling.env
secret_file=/etc/freetalk/internal-signaling-secret
test -f "$env_file"
test -s "$secret_file"

internal_secret="$(tr -d '\r\n' < "$secret_file")"
env_tmp="$(mktemp /etc/freetalk/signaling.env.XXXXXX)"
cleanup() { rm -f "$env_tmp"; }
trap cleanup EXIT

grep -Ev '^(NODE_ENV|ACCOUNT_API_URL|INTERNAL_SIGNALING_SECRET|SIGNALING_ALLOW_INSECURE_DEVELOPMENT)=' "$env_file" > "$env_tmp"
printf '%s\n' \
  'NODE_ENV=production' \
  'ACCOUNT_API_URL=http://127.0.0.1:8790' \
  'SIGNALING_ALLOW_INSECURE_DEVELOPMENT=false' \
  "INTERNAL_SIGNALING_SECRET=${internal_secret}" >> "$env_tmp"

install -o root -g root -m 600 "$env_tmp" "$env_file"
systemctl restart freetalk-signaling
systemctl is-active --quiet freetalk-signaling

echo 'Signaling account authorization is active.'
