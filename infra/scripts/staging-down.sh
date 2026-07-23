#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/../compose" && pwd)"
env_file="${1:-${compose_dir}/.env.staging}"

if [[ ! -f "$env_file" ]] ||
  ! grep -Eq '^COMPOSE_PROJECT_NAME=cloud-staging$' "$env_file"; then
  echo "Refusing to run without a cloud-staging environment file." >&2
  exit 1
fi

docker compose \
  -p cloud-staging \
  --env-file "$env_file" \
  -f "${compose_dir}/docker-compose.pi.yml" \
  down --remove-orphans --volumes
