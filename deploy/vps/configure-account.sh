#!/usr/bin/env bash
set -euo pipefail

secret_dir=/etc/freetalk
install -d -m 700 "$secret_dir"

for required in db-password turnstile.secret smtp-user smtp-password email-from; do
  if [[ ! -s "$secret_dir/$required" ]]; then
    echo "Missing $secret_dir/$required" >&2
    exit 1
  fi
done

create_secret() {
  local name="$1"
  if [[ ! -s "$secret_dir/$name" ]]; then
    openssl rand -hex 48 > "$secret_dir/$name"
  fi
  chown root:freetalk "$secret_dir/$name"
  chmod 640 "$secret_dir/$name"
}

create_secret token-pepper
create_secret internal-signaling-secret
create_secret ip-hash-salt

db_password="$(tr -d '\r\n' < "$secret_dir/db-password")"
turnstile_secret="$(tr -d '\r\n' < "$secret_dir/turnstile.secret")"
smtp_user="$(tr -d '\r\n' < "$secret_dir/smtp-user")"
smtp_password="$(tr -d ' \r\n' < "$secret_dir/smtp-password")"
email_from="$(tr -d '\r\n' < "$secret_dir/email-from")"
token_pepper="$(tr -d '\r\n' < "$secret_dir/token-pepper")"
internal_secret="$(tr -d '\r\n' < "$secret_dir/internal-signaling-secret")"
ip_hash_salt="$(tr -d '\r\n' < "$secret_dir/ip-hash-salt")"

umask 027
env_tmp="$(mktemp "$secret_dir/api.env.XXXXXX")"
cleanup() { rm -f "$env_tmp"; }
trap cleanup EXIT

{
  printf '%s\n' \
    'NODE_ENV=production' \
    'API_HOST=127.0.0.1' \
    'API_PORT=8790' \
    'API_PUBLIC_URL=https://freetalk.191-44-38-60.sslip.io/api' \
    'ALLOWED_ORIGIN=http://tauri.localhost,tauri://localhost,http://localhost:1420' \
    "DATABASE_URL=postgresql://freetalk:${db_password}@127.0.0.1:5432/freetalk" \
    'DATABASE_SSL=false' \
    "TOKEN_PEPPER=${token_pepper}" \
    "INTERNAL_SIGNALING_SECRET=${internal_secret}" \
    "TURNSTILE_SECRET_KEY=${turnstile_secret}" \
    'CAPTCHA_BYPASS_LOCAL=false' \
    'EMAIL_DELIVERY_MODE=smtp' \
    'SMTP_HOST=smtp-relay.brevo.com' \
    'SMTP_PORT=587' \
    'SMTP_SECURE=false' \
    "SMTP_USER=${smtp_user}" \
    "SMTP_PASSWORD=${smtp_password}" \
    "EMAIL_FROM=${email_from}" \
    "IP_HASH_SALT=${ip_hash_salt}"
} > "$env_tmp"

install -o root -g freetalk -m 640 "$env_tmp" "$secret_dir/api.env"
systemctl daemon-reload
systemctl enable --now freetalk-api
systemctl is-active --quiet freetalk-api
for _ in {1..20}; do
  if curl --fail --silent http://127.0.0.1:8790/health >/dev/null; then
    break
  fi
  sleep 0.25
done
curl --fail --silent --show-error http://127.0.0.1:8790/health >/dev/null

echo 'FreeTalk account API is healthy.'
