#!/bin/bash
# Starts mongod as a single-node replica set with keyfile internal auth.
# The keyfile is generated inside the container (not bind-mounted) to avoid
# host filesystem permission issues on Windows/macOS.

set -euo pipefail

KEYFILE=/tmp/replica-keyfile

if [ ! -f "$KEYFILE" ]; then
  openssl rand -base64 756 >"$KEYFILE"
fi
chmod 400 "$KEYFILE"
chown 999:999 "$KEYFILE"

exec docker-entrypoint.sh mongod \
  --replSet rs0 \
  --keyFile "$KEYFILE" \
  --bind_ip_all \
  --wiredTigerCacheSizeGB "${MONGO_WIREDTIGER_CACHE_GB:-0.25}"
