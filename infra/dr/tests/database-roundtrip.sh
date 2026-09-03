#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

root="$(cd "$(dirname "$0")/../../.." && pwd)"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
pg_source="deniz-dr-it-pg-source-${run_id}"
pg_target="deniz-dr-it-pg-target-${run_id}"
mongo_source="deniz-dr-it-mongo-source-${run_id}"
mongo_target="deniz-dr-it-mongo-target-${run_id}"
redis_source="deniz-dr-it-redis-source-${run_id}"
redis_verify="deniz-dr-it-redis-verify-${run_id}"
redis_bootstrap="deniz-dr-it-redis-bootstrap-${run_id}"
redis_seed="deniz-dr-it-redis-seed-${run_id}"
redis_target="deniz-dr-it-redis-target-${run_id}"
work="$(mktemp -d "${TMPDIR:-/tmp}/dr-database-roundtrip.XXXXXX")"

cleanup() {
  local container
  for container in "$pg_source" "$pg_target" "$mongo_source" "$mongo_target" \
    "$redis_source" "$redis_verify" "$redis_bootstrap" "$redis_seed" "$redis_target"; do
    docker rm -fv "$container" >/dev/null 2>&1 || true
  done
  [[ "$work" == "${TMPDIR:-/tmp}"/dr-database-roundtrip.* ]] && rm -rf -- "$work"
}
trap cleanup EXIT

for command in awk cmp diff docker jq mktemp; do
  command -v "$command" >/dev/null || { echo "missing database round-trip dependency: ${command}" >&2; exit 1; }
done
for image in postgres:16-alpine mongo:8.2.11 redis:7-alpine; do
  docker image inspect "$image" >/dev/null 2>&1 \
    || { echo "missing local integration image: ${image}" >&2; exit 1; }
done

wait_for_postgres() {
  local container="$1"
  for _ in $(seq 1 60); do
    if [[ "$(docker exec "$container" psql -X -qAt -U user-name -d cloud-db \
      -c 'SELECT 1' 2>/dev/null)" == 1 ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

docker run -d --name "$pg_source" --network none \
  -e POSTGRES_USER=user-name -e POSTGRES_PASSWORD=test-password -e POSTGRES_DB=cloud-db \
  postgres:16-alpine >/dev/null
wait_for_postgres "$pg_source" || { echo "source PostgreSQL did not become ready" >&2; exit 1; }
docker exec -i "$pg_source" psql -v ON_ERROR_STOP=1 -U user-name -d cloud-db >/dev/null <<'SQL'
CREATE TABLE proof(id integer PRIMARY KEY, value text NOT NULL);
INSERT INTO proof VALUES (1, 'restored');
CREATE TABLE deployments(
  id uuid PRIMARY KEY,
  target_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  image_tag text,
  image_digest text
);
CREATE TABLE deploy_domains(
  target_id uuid NOT NULL,
  hostname text NOT NULL,
  is_primary boolean NOT NULL
);
INSERT INTO deployments VALUES (
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'production',
  'ready',
  'ghcr.io/denizlg24/example@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
);
INSERT INTO deploy_domains VALUES (
  '22222222-2222-4222-8222-222222222222',
  'app.denizlg24.com',
  true
);
CREATE ROLE reader NOLOGIN;
GRANT SELECT ON proof TO reader;
SQL
docker exec -i "$pg_source" psql -X -qAt -v ON_ERROR_STOP=1 -v database=cloud-db \
  -U user-name -d cloud-db < "$root/infra/dr/lib/postgres-forge-control-plane.sql" \
  | jq -e '.database=="cloud-db" and .deployments==[{
      deploymentId:"11111111-1111-4111-8111-111111111111",
      imageReference:"ghcr.io/denizlg24/example@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      imageDigest:"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      hostname:"app.denizlg24.com"
    }]' >/dev/null \
  || { echo "PostgreSQL Forge control-plane inventory is not exact" >&2; exit 1; }
docker exec "$pg_source" pg_dumpall -U user-name --globals-only > "$work/globals.sql"
docker exec "$pg_source" pg_dump -U user-name -Fc --create -d cloud-db > "$work/cloud-db.dump"

docker run -d --name "$pg_target" --network none \
  -e POSTGRES_USER=user-name -e POSTGRES_PASSWORD=test-password -e POSTGRES_DB=cloud-db \
  postgres:16-alpine >/dev/null
wait_for_postgres "$pg_target" || { echo "target PostgreSQL did not become ready" >&2; exit 1; }
bootstrap_create_role="$(docker exec "$pg_target" psql -X -qAt -v ON_ERROR_STOP=1 -U user-name -d cloud-db \
  -c "SELECT format('CREATE ROLE %I;', current_user)")"
[[ "$bootstrap_create_role" == 'CREATE ROLE "user-name";' ]] \
  || { echo "PostgreSQL did not render the expected quoted bootstrap role" >&2; exit 1; }
awk -v duplicate="$bootstrap_create_role" '$0 != duplicate' "$work/globals.sql" \
  | docker exec -i "$pg_target" psql -q -v ON_ERROR_STOP=1 -U user-name -d cloud-db >/dev/null
docker exec "$pg_target" dropdb --maintenance-db=template1 --force --if-exists -U user-name -- cloud-db
docker exec -i "$pg_target" pg_restore --exit-on-error --create -U user-name -d template1 \
  < "$work/cloud-db.dump" >/dev/null
[[ "$(docker exec "$pg_target" psql -X -qAt -U user-name -d cloud-db -c 'SELECT value FROM proof WHERE id=1')" == restored ]] \
  || { echo "PostgreSQL table data did not restore" >&2; exit 1; }
[[ "$(docker exec "$pg_target" psql -X -qAt -U user-name -d cloud-db -c "SELECT rolname FROM pg_roles WHERE rolname='reader'")" == reader ]] \
  || { echo "PostgreSQL role did not restore" >&2; exit 1; }

docker run -d --name "$mongo_source" --network none \
  --mount "type=bind,source=$root/infra/dr/lib/mongo-semantic.js,target=/semantic.js,readonly" \
  mongo:8.2.11 mongod --replSet rs0 --bind_ip_all --quiet \
  --setParameter diagnosticDataCollectionEnabled=false >/dev/null
for _ in $(seq 1 60); do
  docker exec "$mongo_source" mongosh --quiet --eval 'quit(db.adminCommand({ping:1}).ok===1 ? 0 : 1)' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$mongo_source" mongosh --quiet --eval \
  'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})' >/dev/null
for _ in $(seq 1 60); do
  docker exec "$mongo_source" mongosh --quiet --eval 'quit(db.hello().isWritablePrimary ? 0 : 1)' >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$mongo_source" mongosh --quiet cloud --eval '
  db.proof.insertMany([{id:1,value:"restored"},{id:2,value:"also-restored"}]);
  db.proof.createIndex({value:1},{unique:true});
  db.createRole({role:"proofReader",privileges:[{resource:{db:"cloud",collection:"proof"},actions:["find"]}],roles:[]});
' >/dev/null
docker exec "$mongo_source" mongosh --quiet admin --eval '
  db.createUser({user:"recovery-user",pwd:"test-password",roles:[{role:"read",db:"cloud"}]});
' >/dev/null
docker exec -e DR_MONGO_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0' "$mongo_source" \
  mongosh --quiet --nodb --file /semantic.js | tail -1 | jq -S . > "$work/mongo-expected.json"
docker exec "$mongo_source" mongodump --uri='mongodb://127.0.0.1:27017/?replicaSet=rs0' \
  --oplog --archive --gzip > "$work/mongodb.archive.gz"

docker run -d --name "$mongo_target" --network none \
  --mount "type=bind,source=$root/infra/dr/lib/mongo-semantic.js,target=/semantic.js,readonly" \
  mongo:8.2.11 mongod --bind_ip_all --quiet \
  --setParameter diagnosticDataCollectionEnabled=false >/dev/null
for _ in $(seq 1 60); do
  docker exec "$mongo_target" mongosh --quiet --eval 'quit(db.adminCommand({ping:1}).ok===1 ? 0 : 1)' >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$mongo_target" mongorestore --archive --gzip --oplogReplay --drop \
  < "$work/mongodb.archive.gz" >/dev/null
docker exec -e DR_MONGO_URI='mongodb://127.0.0.1:27017' "$mongo_target" \
  mongosh --quiet --nodb --file /semantic.js | tail -1 | jq -S . > "$work/mongo-actual.json"
cmp -s "$work/mongo-actual.json" "$work/mongo-expected.json" \
  || { echo "MongoDB oplog archive semantics did not restore" >&2; exit 1; }

install -d -m 0777 "$work/redis-source" "$work/redis-target"
docker run -d --name "$redis_source" --network none --user 0:0 \
  --mount "type=bind,source=$work/redis-source,target=/data" \
  redis:7-alpine redis-server --dir /data --appendonly yes --save '' >/dev/null
for _ in $(seq 1 60); do docker exec "$redis_source" redis-cli ping 2>/dev/null | grep -qx PONG && break; sleep 1; done
docker exec "$redis_source" redis-cli SET persistent value >/dev/null
docker exec "$redis_source" redis-cli SET expiring temporary PX 120000 >/dev/null
docker exec "$redis_source" redis-cli SAVE >/dev/null
docker stop "$redis_source" >/dev/null

docker run -d --name "$redis_verify" --network none --user 0:0 \
  --mount "type=bind,source=$work/redis-source,target=/data" \
  --mount "type=bind,source=$root/infra/dr/lib/redis-semantic.lua,target=/semantic.lua,readonly" \
  redis:7-alpine redis-server --dir /data --appendonly no --save '' >/dev/null
for _ in $(seq 1 60); do docker exec "$redis_verify" redis-cli ping 2>/dev/null | grep -qx PONG && break; sleep 1; done
docker exec "$redis_verify" redis-cli --raw --eval /semantic.lua | jq -S . > "$work/redis-expected.json"
docker stop "$redis_verify" >/dev/null

docker run -d --name "$redis_bootstrap" --network none --user 0:0 \
  --mount "type=bind,source=$work/redis-target,target=/data" \
  redis:7-alpine redis-server --dir /data --appendonly yes --save '' >/dev/null
for _ in $(seq 1 60); do docker exec "$redis_bootstrap" redis-cli ping 2>/dev/null | grep -qx PONG && break; sleep 1; done
docker stop "$redis_bootstrap" >/dev/null
[[ -d "$work/redis-target/appendonlydir" ]] || { echo "Redis bootstrap did not create the expected AOF" >&2; exit 1; }
rm -rf -- "$work/redis-target/appendonlydir"
rm -f -- "$work/redis-target/appendonly.aof"
install -m 0600 "$work/redis-source/dump.rdb" "$work/redis-target/dump.rdb"

docker run -d --name "$redis_seed" --network none --user 0:0 \
  --mount "type=bind,source=$work/redis-target,target=/data" \
  redis:7-alpine redis-server --dir /data --appendonly no --save '' >/dev/null
for _ in $(seq 1 60); do docker exec "$redis_seed" redis-cli ping 2>/dev/null | grep -qx PONG && break; sleep 1; done
docker exec "$redis_seed" redis-cli CONFIG SET appendonly yes | grep -qx OK
redis_aof_ready=false
for _ in $(seq 1 120); do
  redis_persistence="$(docker exec "$redis_seed" redis-cli INFO persistence | tr -d '\r')"
  if grep -qx 'aof_enabled:1' <<< "$redis_persistence" \
    && grep -qx 'aof_rewrite_in_progress:0' <<< "$redis_persistence" \
    && grep -qx 'aof_last_bgrewrite_status:ok' <<< "$redis_persistence" \
    && grep -Eq '^aof_base_size:[1-9][0-9]*$' <<< "$redis_persistence"; then
    redis_aof_ready=true
    break
  fi
  sleep 1
done
[[ "$redis_aof_ready" == true ]] || { echo "Redis test AOF rewrite did not complete" >&2; exit 1; }
docker stop "$redis_seed" >/dev/null

docker run -d --name "$redis_target" --network none --user 0:0 \
  --mount "type=bind,source=$work/redis-target,target=/data" \
  --mount "type=bind,source=$root/infra/dr/lib/redis-semantic.lua,target=/semantic.lua,readonly" \
  redis:7-alpine redis-server --dir /data --appendonly yes --save '' >/dev/null
for _ in $(seq 1 60); do docker exec "$redis_target" redis-cli ping 2>/dev/null | grep -qx PONG && break; sleep 1; done
docker exec "$redis_target" redis-cli --raw --eval /semantic.lua | jq -S . > "$work/redis-actual.json"
verified_at="$(jq -er '.capturedAtMs | select(type=="number" and .>=0 and floor==.)' "$work/redis-actual.json")"
jq -S 'del(.capturedAtMs)' "$work/redis-actual.json" > "$work/redis-actual.normalized.json"
jq -S --argjson verifiedAt "$verified_at" '
  .entries |= map(select(.expiresAtMs==null or .expiresAtMs>$verifiedAt)) |
  .keys=(.entries|length) | del(.capturedAtMs)
' "$work/redis-expected.json" > "$work/redis-expected.normalized.json"
if ! cmp -s "$work/redis-actual.normalized.json" "$work/redis-expected.normalized.json"; then
  diff -u "$work/redis-expected.normalized.json" "$work/redis-actual.normalized.json" >&2 || true
  echo "Redis RDB/AOF/TTL semantics did not restore" >&2
  exit 1
fi

printf 'Database disposable restore round-trips passed\n'
