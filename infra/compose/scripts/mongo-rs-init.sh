#!/bin/bash
# Initiates the single-node replica set rs0 once mongod is up and authenticated.
# Host clients should connect with directConnection=true (the configured member
# host `mongodb:27017` only resolves inside the compose network).

set -euo pipefail

mongo_args=(
  --host mongodb
  --port 27017
  --username "$MONGO_USER"
  --password "$MONGO_PASS"
  --authenticationDatabase admin
  --quiet
)

echo "[mongo-init] Checking replica set..."
if ! mongosh "${mongo_args[@]}" --eval "quit(rs.status().ok === 1 ? 0 : 1)" >/dev/null 2>&1; then
  echo "[mongo-init] Initiating replica set rs0..."
  mongosh "${mongo_args[@]}" --eval '
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongodb:27017" }] });
  '
fi

echo "[mongo-init] Waiting for the primary..."
for attempt in $(seq 1 30); do
  if mongosh "${mongo_args[@]}" --eval "quit(db.hello().isWritablePrimary ? 0 : 1)" >/dev/null 2>&1; then
    echo "[mongo-init] Done"
    exit 0
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "[mongo-init] Replica set did not elect a primary" >&2
    exit 1
  fi
  sleep 2
done
