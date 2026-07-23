#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/../compose" && pwd)"
env_file="${1:-${compose_dir}/.env.staging}"
staging_root="/srv/deniz-cloud-staging"

if [[ ! -f "$env_file" ]]; then
  echo "Missing ${env_file}; copy .env.staging.example and replace its secrets." >&2
  exit 1
fi
if ! grep -Eq '^COMPOSE_PROJECT_NAME=cloud-staging$' "$env_file"; then
  echo "Refusing to run: COMPOSE_PROJECT_NAME must be cloud-staging." >&2
  exit 1
fi

install -d -m 700 \
  "${staging_root}/secrets" \
  "${staging_root}/data/postgres" \
  "${staging_root}/data/mongo" \
  "${staging_root}/data/mongot" \
  "${staging_root}/data/redis" \
  "${staging_root}/data/meilisearch" \
  "${staging_root}/storage/ssd" \
  "${staging_root}/storage/hdd" \
  "${staging_root}/backups" \
  "${staging_root}/host-control"

keyfile="${staging_root}/secrets/mongo-replica-keyfile"
if [[ ! -s "$keyfile" ]]; then
  openssl rand -base64 756 > "$keyfile"
  chmod 400 "$keyfile"
fi

docker compose \
  -p cloud-staging \
  --env-file "$env_file" \
  -f "${compose_dir}/docker-compose.pi.yml" \
  up --detach --wait
