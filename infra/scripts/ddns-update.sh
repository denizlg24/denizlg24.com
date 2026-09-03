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
[[ ${#CF_API_TOKEN} -ge 20 && "$CF_API_TOKEN" != *[$'\r\n"\\']* && "$CF_ZONE_ID" =~ ^[A-Za-z0-9_-]+$ ]] \
  || { echo "[$(date -Iseconds)] ERROR: Cloudflare credentials are unsafe" >&2; exit 1; }

cf_api="https://api.cloudflare.com/client/v4"
record_names="${DDNS_RECORDS:-mongodb.denizlg24.com,postgres.denizlg24.com,redis.denizlg24.com,me.denizlg24.com}"
active_site_record="${DDNS_ACTIVE_SITE_RECORD:-_active-site-pi.denizlg24.com}"
active_site_value="${DDNS_ACTIVE_SITE_VALUE:-home}"
[[ "$active_site_record" =~ ^[A-Za-z0-9._-]+$ && "$active_site_value" =~ ^[A-Za-z0-9_-]+$ ]] \
  || { echo "[$(date -Iseconds)] ERROR: active-site lease configuration is unsafe" >&2; exit 1; }
curl_config="$(mktemp "${TMPDIR:-/tmp}/deniz-ddns.XXXXXX")"
chmod 600 "$curl_config"
printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$CF_API_TOKEN" > "$curl_config"
trap 'rm -f -- "$curl_config"' EXIT

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
    --config "$curl_config" \
    "$@"
}

lease_lookup="$(cloudflare_request "${cf_api}/zones/${CF_ZONE_ID}/dns_records?type=TXT&name=${active_site_record}")"
lease_value="$(jq -er '.result | if length == 1 then .[0].content else empty end' <<< "$lease_lookup")" \
  || { echo "[$(date -Iseconds)] ERROR: active-site lease is missing or ambiguous" >&2; exit 1; }
lease_value="${lease_value#\"}"; lease_value="${lease_value%\"}"
if [[ "$lease_value" != "$active_site_value" ]]; then
  echo "[$(date -Iseconds)] FENCED: active-site lease is ${lease_value}; home DDNS made no changes"
  exit 0
fi

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
  [[ "$record" =~ ^[A-Za-z0-9.-]+$ && "$record" == *.* ]] \
    || { echo "[$(date -Iseconds)] ERROR: unsafe DDNS record name" >&2; exit 1; }
  lookup="$(
    cloudflare_request \
      "${cf_api}/zones/${CF_ZONE_ID}/dns_records?type=A&name=${record}"
  )"
  record_id="$(
    jq -r '.result[0].id // empty' <<< "$lookup"
  )"
  if [[ -z "$record_id" ]]; then
    echo "[$(date -Iseconds)] ERROR: A record not found for ${record}" >&2
    exit 1
  fi
  [[ "$record_id" =~ ^[A-Za-z0-9_-]+$ ]] \
    || { echo "[$(date -Iseconds)] ERROR: unsafe Cloudflare record id" >&2; exit 1; }

  payload="$(
    jq -cn --arg name "$record" --arg content "$current_ip" \
      '{type:"A",name:$name,content:$content,ttl:60,proxied:false}'
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
