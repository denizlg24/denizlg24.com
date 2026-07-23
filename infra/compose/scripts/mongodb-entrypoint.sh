#!/bin/bash

set -euo pipefail

cp /run/secrets/mongo-replica-keyfile /tmp/replica-keyfile
chmod 400 /tmp/replica-keyfile
chown 999:999 /tmp/replica-keyfile

args=(
  --wiredTigerCacheSizeGB "${MONGO_WIREDTIGER_CACHE_GB:-0.25}"
  --replSet rs0
  --keyFile /tmp/replica-keyfile
  --quiet
  --setParameter diagnosticDataCollectionEnabled=false
)

if [[ "${MONGO_SEARCH_ENABLED:-true}" == "true" ]]; then
  args+=(
    --setParameter searchIndexManagementHostAndPort=mongot:27028
    --setParameter mongotHost=mongot:27028
    --setParameter skipAuthenticationToSearchIndexManagementServer=false
    --setParameter useGrpcForSearch=true
    --setParameter searchTLSMode=disabled
  )
fi

case "${MONGO_TLS_MODE:-disabled}" in
  disabled)
    ;;
  allowTLS)
    cp /run/db-tls/server.pem /tmp/mongodb-server.pem
    chmod 400 /tmp/mongodb-server.pem
    chown 999:999 /tmp/mongodb-server.pem
    args+=(
      --tlsMode allowTLS
      --tlsCertificateKeyFile /tmp/mongodb-server.pem
    )
    ;;
  *)
    echo "MONGO_TLS_MODE must be disabled or allowTLS" >&2
    exit 1
    ;;
esac

exec docker-entrypoint.sh mongod "${args[@]}"
