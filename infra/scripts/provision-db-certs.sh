#!/bin/bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

env_file="${DDNS_ENV_FILE:-/etc/deniz-cloud/ddns.env}"
credentials_file="/etc/deniz-cloud/cloudflare-dns.ini"
certificate_name="${DB_CERTIFICATE_NAME:-deniz-cloud-databases}"

if [[ ! -f "$env_file" ]]; then
  echo "Missing ${env_file}; install the DDNS environment first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

: "${CF_API_TOKEN:?CF_API_TOKEN is required}"
: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL is required}"

if ! command -v certbot >/dev/null ||
  ! certbot plugins 2>/dev/null | grep -q 'dns-cloudflare'; then
  echo "Install certbot and python3-certbot-dns-cloudflare first:" >&2
  echo "  sudo apt install certbot python3-certbot-dns-cloudflare" >&2
  exit 1
fi

install -d -m 700 /etc/deniz-cloud
temporary_credentials="$(mktemp)"
trap 'rm -f "$temporary_credentials"' EXIT
printf 'dns_cloudflare_api_token = %s\n' "$CF_API_TOKEN" > "$temporary_credentials"
install -m 600 "$temporary_credentials" "$credentials_file"

certbot certonly \
  --non-interactive \
  --agree-tos \
  --email "$LETSENCRYPT_EMAIL" \
  --cert-name "$certificate_name" \
  --dns-cloudflare \
  --dns-cloudflare-credentials "$credentials_file" \
  --dns-cloudflare-propagation-seconds 30 \
  -d postgres.denizlg24.com \
  -d mongodb.denizlg24.com \
  -d redis.denizlg24.com

/usr/local/lib/deniz-cloud/deploy-db-certs.sh
