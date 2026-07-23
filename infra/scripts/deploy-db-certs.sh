#!/bin/bash

set -euo pipefail

certificate_name="${DB_CERTIFICATE_NAME:-deniz-cloud-databases}"
source_dir="/etc/letsencrypt/live/${certificate_name}"
target_root="${DB_TLS_ROOT:-/etc/deniz-cloud/tls}"
compose_dir="${CLOUD_COMPOSE_DIR:-/opt/deniz-cloud/infra/compose}"
compose_env="${CLOUD_COMPOSE_ENV:-${compose_dir}/.env.pi}"

for file in fullchain.pem privkey.pem; do
  if [[ ! -s "${source_dir}/${file}" ]]; then
    echo "Missing certificate file: ${source_dir}/${file}" >&2
    exit 1
  fi
done

for service in postgres redis; do
  install -d -m 700 "${target_root}/${service}"
  install -m 644 "${source_dir}/fullchain.pem" \
    "${target_root}/${service}/fullchain.pem"
  install -m 600 "${source_dir}/privkey.pem" \
    "${target_root}/${service}/privkey.pem"
done

install -d -m 700 "${target_root}/mongodb"
temporary_pem="$(mktemp)"
trap 'rm -f "$temporary_pem"' EXIT
cat "${source_dir}/fullchain.pem" "${source_dir}/privkey.pem" > "$temporary_pem"
install -m 600 "$temporary_pem" "${target_root}/mongodb/server.pem"

if [[ -f "$compose_env" ]] &&
  docker compose \
    --env-file "$compose_env" \
    -f "${compose_dir}/docker-compose.pi.yml" \
    ps --status running --quiet postgres mongodb redis | grep -q .; then
  docker compose \
    --env-file "$compose_env" \
    -f "${compose_dir}/docker-compose.pi.yml" \
    restart postgres mongodb redis
fi
