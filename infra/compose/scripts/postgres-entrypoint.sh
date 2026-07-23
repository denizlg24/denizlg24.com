#!/bin/sh

set -eu

case "${POSTGRES_TLS_MODE:-off}" in
  off)
    ;;
  on)
    cp /run/db-tls/fullchain.pem /tmp/postgres-fullchain.pem
    cp /run/db-tls/privkey.pem /tmp/postgres-privkey.pem
    chmod 644 /tmp/postgres-fullchain.pem
    chmod 600 /tmp/postgres-privkey.pem
    chown postgres:postgres /tmp/postgres-fullchain.pem /tmp/postgres-privkey.pem
    ;;
  *)
    echo "POSTGRES_TLS_MODE must be off or on" >&2
    exit 1
    ;;
esac

exec docker-entrypoint.sh "$@"
