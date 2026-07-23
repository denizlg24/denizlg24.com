#!/bin/bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

ufw allow in on tailscale0 comment "trusted tailnet"
ufw limit 22/tcp comment "rate-limited break-glass SSH"
ufw allow 5433/tcp comment "public PostgreSQL"
ufw allow 27018/tcp comment "public MongoDB"
ufw allow 6380/tcp comment "public Redis plaintext"

if [[ "${ENABLE_REDIS_TLS_PORT:-false}" == "true" ]]; then
  ufw allow 6381/tcp comment "public Redis TLS"
fi

ufw deny 3001/tcp comment "API is Cloudflare Tunnel or loopback only"
ufw deny 3003/tcp comment "terminal is loopback only"

ufw status numbered
