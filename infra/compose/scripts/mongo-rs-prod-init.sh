#!/bin/bash

set -euo pipefail

mongo_args=(
  --host mongodb
  --port 27017
  --username "$MONGO_USER"
  --password "$MONGO_PASS"
  --authenticationDatabase admin
  --quiet
)

mongosh_admin() {
  mongosh "${mongo_args[@]}" "$@"
}

echo "[mongo-init] Checking replica set..."
if ! mongosh_admin --eval "quit(rs.status().ok === 1 ? 0 : 1)" >/dev/null 2>&1; then
  echo "[mongo-init] Initiating replica set rs0..."
  mongosh_admin --eval '
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongodb:27017" }] });
  '
fi

echo "[mongo-init] Waiting for the primary..."
for attempt in $(seq 1 30); do
  if mongosh_admin --eval "quit(db.hello().isWritablePrimary ? 0 : 1)" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "30" ]]; then
    echo "[mongo-init] Replica set did not elect a primary" >&2
    exit 1
  fi
  sleep 2
done

echo "[mongo-init] Ensuring service users exist..."
# The single-quoted program intentionally leaves JavaScript template literals
# and process.env references for mongosh.
# shellcheck disable=SC2016
mongosh_admin --eval '
  const admin = db.getSiblingDB("admin");
  const users = [
    {
      user: process.env.SYNC_USER,
      pwd: process.env.SYNC_PASS,
      roles: [{ role: "readAnyDatabase", db: "admin" }],
    },
    {
      user: process.env.SEARCH_USER,
      pwd: process.env.SEARCH_PASS,
      roles: [{ role: "searchCoordinator", db: "admin" }],
    },
  ];

  for (const spec of users) {
    if (admin.getUser(spec.user)) {
      admin.updateUser(spec.user, { pwd: spec.pwd, roles: spec.roles });
      print(`[mongo-init] Updated ${spec.user}`);
    } else {
      admin.createUser(spec);
      print(`[mongo-init] Created ${spec.user}`);
    }
  }
'

install -d -m 700 /run/mongot-secrets
umask 177
printf '%s' "$SEARCH_PASS" > /run/mongot-secrets/passwordFile
chmod 400 /run/mongot-secrets/passwordFile

echo "[mongo-init] Done"
