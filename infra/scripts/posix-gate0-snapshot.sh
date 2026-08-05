#!/bin/bash

set -euo pipefail

umask 077

compose_dir="${CLOUD_COMPOSE_DIR:-/opt/deniz-cloud/infra/compose}"
compose_env="${CLOUD_COMPOSE_ENV:-${compose_dir}/.env.pi}"
api_container="${API_CONTAINER:-deniz-cloud-api-1}"
postgres_container="${POSTGRES_CONTAINER:-deniz-cloud-postgres-1}"
mongo_container="${MONGODB_CONTAINER:-deniz-cloud-mongodb-1}"
redis_container="${REDIS_CONTAINER:-deniz-cloud-redis-1}"
mode="--dry-run"
mode_set=false
allow_live_api=false

usage() {
  echo "Usage: $0 [--dry-run|--execute] [--allow-live-api]" >&2
}

for argument in "$@"; do
  case "$argument" in
    --dry-run | --execute)
      if [[ "$mode_set" == "true" ]]; then
        usage
        exit 2
      fi
      mode="$argument"
      mode_set=true
      ;;
    --allow-live-api)
      allow_live_api=true
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done
if [[ ! -f "$compose_env" ]]; then
  echo "Missing Compose environment: ${compose_env}" >&2
  exit 1
fi

env_path() {
  local key="$1"
  local value
  value="$(sed -n "s/^${key}=//p" "$compose_env")"
  if [[ -z "$value" || "$value" != /* || "$value" == *$'\n'* ]]; then
    echo "${key} must be one absolute path in ${compose_env}" >&2
    exit 1
  fi
  printf '%s\n' "$value"
}

ssd_path="${POSIX_SSD_PATH:-$(env_path SSD_STORAGE_PATH)}"
hdd_path="${POSIX_HDD_PATH:-$(env_path HDD_STORAGE_PATH)}"
snapshot_root="${POSIX_SNAPSHOT_ROOT:-$(env_path BACKUP_DIR)}"
snapshot_id="${POSIX_SNAPSHOT_ID:-posix-gate0-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ ! "$snapshot_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ || "$snapshot_id" == *..* ]]; then
  echo "POSIX_SNAPSHOT_ID must be one safe path segment" >&2
  exit 1
fi
snapshot_dir="${snapshot_root}/${snapshot_id}"

for command in docker tar zstd pigz gzip sha256sum find findmnt realpath du df jq sync; do
  if ! command -v "$command" >/dev/null; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done
for path in "$ssd_path" "$hdd_path" "$snapshot_root"; do
  if [[ ! -d "$path" ]]; then
    echo "Required directory is missing: ${path}" >&2
    exit 1
  fi
done

ssd_real="$(realpath -e "$ssd_path")"
hdd_real="$(realpath -e "$hdd_path")"
snapshot_root_real="$(realpath -e "$snapshot_root")"
if [[ "$ssd_real" == "/" || "$hdd_real" == "/" || "$snapshot_root_real" == "/" || "$ssd_real" == "$hdd_real" ]]; then
  echo "Storage roots must be distinct directories below /" >&2
  exit 1
fi
for storage_root in "$ssd_real" "$hdd_real"; do
  if [[ "$snapshot_root_real" == "$storage_root" || "$snapshot_root_real" == "$storage_root/"* ]]; then
    echo "Snapshot root must be outside both storage roots" >&2
    exit 1
  fi
done

read -r ssd_source ssd_fstype ssd_options < <(
  findmnt -T "$ssd_real" -n -o SOURCE,FSTYPE,OPTIONS
)
read -r hdd_source hdd_fstype hdd_options < <(
  findmnt -T "$hdd_real" -n -o SOURCE,FSTYPE,OPTIONS
)
if [[ "$ssd_source" == "$hdd_source" || "$ssd_fstype" != "ext4" || "$hdd_fstype" != "ext4" ]]; then
  echo "Storage roots must resolve to distinct ext4 sources" >&2
  exit 1
fi
if [[ ",$ssd_options," == *,ro,* || ",$hdd_options," == *,ro,* ]]; then
  echo "Storage sources must be mounted read-write" >&2
  exit 1
fi

ssd_bytes="$(du -sb --one-file-system "$ssd_real" | awk '{print $1}')"
hdd_bytes="$(du -sb --one-file-system "$hdd_real" | awk '{print $1}')"
required_bytes=$((ssd_bytes + hdd_bytes + 1073741824))
available_bytes="$(df -B1 --output=avail "$snapshot_root_real" | awk 'NR == 2 {print $1}')"
if (( available_bytes < required_bytes )); then
  echo "Insufficient snapshot space: ${available_bytes} available, ${required_bytes} required" >&2
  exit 1
fi

api_running="$(docker inspect --format '{{.State.Running}}' "$api_container")"
for container in "$postgres_container" "$mongo_container" "$redis_container"; do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container")" != "true" ]]; then
    echo "Required data container is not running: ${container}" >&2
    exit 1
  fi
done

jq -n \
  --arg mode "$mode" \
  --arg snapshotDir "$snapshot_dir" \
  --arg ssdPath "$ssd_real" \
  --arg ssdSource "$ssd_source" \
  --arg hddPath "$hdd_real" \
  --arg hddSource "$hdd_source" \
  --argjson ssdBytes "$ssd_bytes" \
  --argjson hddBytes "$hdd_bytes" \
  --argjson availableBytes "$available_bytes" \
  --arg apiRunning "$api_running" \
  --arg allowLiveApi "$allow_live_api" \
  '{mode:$mode,snapshotDir:$snapshotDir,apiRunning:($apiRunning == "true"),allowLiveApi:($allowLiveApi == "true"),availableBytes:$availableBytes,branches:{ssd:{path:$ssdPath,source:$ssdSource,bytes:$ssdBytes},hdd:{path:$hddPath,source:$hddSource,bytes:$hddBytes}}}'

if [[ "$mode" == "--dry-run" ]]; then
  exit 0
fi
if [[ "$api_running" == "true" && "$allow_live_api" != "true" ]]; then
  echo "Refusing snapshot while ${api_container} is running; stop it or pass the operator-approved --allow-live-api exception" >&2
  exit 1
fi
if [[ -e "$snapshot_dir" ]]; then
  echo "Snapshot destination already exists: ${snapshot_dir}" >&2
  exit 1
fi

mkdir -m 700 "$snapshot_dir"
touch "$snapshot_dir/.incomplete"

archive_branch() {
  local label="$1"
  local source="$2"
  local target="${snapshot_dir}/${label}.tar.zst"
  tar \
    --acls \
    --numeric-owner \
    --one-file-system \
    --sparse \
    --xattrs \
    --xattrs-include='*' \
    -I 'zstd -T0 -3' \
    -cf "${target}.partial" \
    -C "$source" \
    .
  zstd -q -t "${target}.partial"
  mv "${target}.partial" "$target"
}

write_branch_manifests() {
  local label="$1"
  local source="$2"
  (
    cd "$source"
    LC_ALL=C find . -xdev \
      -printf '%y\t%m\t%U\t%G\t%s\t%b\t%T@\t%p\t%l\n' \
      | LC_ALL=C sort > "$snapshot_dir/${label}-tree.tsv"
    LC_ALL=C find . -xdev -type f -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 -r sha256sum --zero -- \
        > "$snapshot_dir/${label}-files.sha256z"
  )
}

archive_branch ssd "$ssd_real"
archive_branch hdd "$hdd_real"
write_branch_manifests ssd "$ssd_real"
write_branch_manifests hdd "$hdd_real"

docker exec "$postgres_container" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dumpall -U "$POSTGRES_USER" --clean --if-exists' \
  | pigz -3 > "$snapshot_dir/postgres.sql.gz.partial"
gzip -t "$snapshot_dir/postgres.sql.gz.partial"
mv "$snapshot_dir/postgres.sql.gz.partial" "$snapshot_dir/postgres.sql.gz"

docker exec "$mongo_container" sh -c \
  'exec mongodump --host=localhost --username="$MONGO_INITDB_ROOT_USERNAME" --password="$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase=admin --archive --gzip' \
  > "$snapshot_dir/mongodb.archive.gz.partial"
gzip -t "$snapshot_dir/mongodb.archive.gz.partial"
mv "$snapshot_dir/mongodb.archive.gz.partial" "$snapshot_dir/mongodb.archive.gz"

docker exec "$redis_container" sh -c 'cat /data/users.acl' \
  > "$snapshot_dir/redis-users.acl.partial"
test -s "$snapshot_dir/redis-users.acl.partial"
mv "$snapshot_dir/redis-users.acl.partial" "$snapshot_dir/redis-users.acl"

runtime_images_jsonl="$snapshot_dir/runtime-images.jsonl"
for container in "$api_container" "$postgres_container" "$mongo_container" "$redis_container"; do
  docker inspect --format \
    '{"name":{{json .Name}},"configuredImage":{{json .Config.Image}},"imageId":{{json .Image}},"state":{{json .State.Status}}}' \
    "$container" >> "$runtime_images_jsonl"
done
jq -s '.' "$runtime_images_jsonl" > "$snapshot_dir/runtime-images.json"
rm "$runtime_images_jsonl"

(
  cd "$snapshot_dir"
  sha256sum \
    hdd.tar.zst \
    mongodb.archive.gz \
    postgres.sql.gz \
    redis-users.acl \
    runtime-images.json \
    hdd-files.sha256z \
    hdd-tree.tsv \
    ssd-files.sha256z \
    ssd-tree.tsv \
    ssd.tar.zst \
    > SHA256SUMS
)

jq -n \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg snapshotId "$snapshot_id" \
  --arg ssdPath "$ssd_real" \
  --arg ssdSource "$ssd_source" \
  --arg ssdFilesystem "$ssd_fstype" \
  --arg hddPath "$hdd_real" \
  --arg hddSource "$hdd_source" \
  --arg hddFilesystem "$hdd_fstype" \
  --argjson ssdBytes "$ssd_bytes" \
  --argjson hddBytes "$hdd_bytes" \
  --arg apiRunning "$api_running" \
  --arg allowLiveApi "$allow_live_api" \
  '{schemaVersion:1,snapshotId:$snapshotId,createdAt:$createdAt,apiFrozen:($apiRunning != "true"),liveApiException:($apiRunning == "true" and $allowLiveApi == "true"),operatorAssumption:(if $apiRunning == "true" then "no storage namespace mutations during snapshot" else null end),branches:{ssd:{path:$ssdPath,source:$ssdSource,filesystem:$ssdFilesystem,bytes:$ssdBytes,archive:"ssd.tar.zst",treeManifest:"ssd-tree.tsv",fileChecksums:"ssd-files.sha256z"},hdd:{path:$hddPath,source:$hddSource,filesystem:$hddFilesystem,bytes:$hddBytes,archive:"hdd.tar.zst",treeManifest:"hdd-tree.tsv",fileChecksums:"hdd-files.sha256z"}},artifacts:{postgres:"postgres.sql.gz",mongodb:"mongodb.archive.gz",redisAcl:"redis-users.acl",runtimeImages:"runtime-images.json",checksums:"SHA256SUMS"}}' \
  > "$snapshot_dir/manifest.json"

rm "$snapshot_dir/.incomplete"
sync -f "$snapshot_dir"
echo "Verified frozen snapshot: ${snapshot_dir}"
