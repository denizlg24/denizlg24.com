#!/bin/bash

set -euo pipefail

env_file="${DDNS_ENV_FILE:-/etc/deniz-cloud/ddns.env}"
cache_file="${DDNS_CACHE_FILE:-/var/lib/deniz-cloud/ddns-current-ip}"

if [[ ! -f "$env_file" ]]; then
  echo "[$(date -Iseconds)] ERROR: environment file not found at $env_file" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$env_file"
set +a

: "${CF_API_TOKEN:?CF_API_TOKEN is required}"
: "${CF_ZONE_ID:?CF_ZONE_ID is required}"

cf_api="https://api.cloudflare.com/client/v4"
record_names="${DDNS_RECORDS:-mongodb.denizlg24.com,postgres.denizlg24.com,redis.denizlg24.com,me.denizlg24.com}"

get_public_ip() {
  local endpoint
  for endpoint in \
    "https://ifconfig.me" \
    "https://api.ipify.org" \
    "https://icanhazip.com"; do
    if curl --fail --silent --show-error --ipv4 --max-time 10 "$endpoint"; then
      return 0
    fi
  done
  return 1
}

cloudflare_request() {
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

current_ip="$(get_public_ip | tr -d '[:space:]')"
if [[ ! "$current_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "[$(date -Iseconds)] ERROR: public IPv4 lookup returned an invalid value" >&2
  exit 1
fi

cached_ip=""
if [[ -f "$cache_file" ]]; then
  cached_ip="$(<"$cache_file")"
fi
if [[ "$current_ip" == "$cached_ip" ]]; then
  exit 0
fi

IFS=',' read -r -a records <<< "$record_names"
for record in "${records[@]}"; do
  record="${record//[[:space:]]/}"
  lookup="$(
    cloudflare_request \
      "${cf_api}/zones/${CF_ZONE_ID}/dns_records?type=A&name=${record}"
  )"
  record_id="$(
    python3 -c \
      'import json,sys; data=json.load(sys.stdin); print(data["result"][0]["id"] if data.get("result") else "")' \
      <<< "$lookup"
  )"
  if [[ -z "$record_id" ]]; then
    echo "[$(date -Iseconds)] ERROR: A record not found for ${record}" >&2
    exit 1
  fi

  payload="$(
    RECORD_NAME="$record" RECORD_IP="$current_ip" python3 -c \
      'import json,os; print(json.dumps({"type":"A","name":os.environ["RECORD_NAME"],"content":os.environ["RECORD_IP"],"ttl":300,"proxied":False}))'
  )"
  cloudflare_request \
    --request PUT \
    --data "$payload" \
    "${cf_api}/zones/${CF_ZONE_ID}/dns_records/${record_id}" >/dev/null
  echo "[$(date -Iseconds)] Updated ${record} -> ${current_ip}"
done

install -d -m 700 "$(dirname "$cache_file")"
printf '%s\n' "$current_ip" > "$cache_file"
chmod 600 "$cache_file"
