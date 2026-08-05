#!/bin/bash

set -euo pipefail

umask 077

mode="${1:-}"
snapshot_dir="${2:-}"
if [[ "$mode" != "--dry-run" && "$mode" != "--execute" ]] || [[ -z "$snapshot_dir" ]]; then
  echo "Usage: $0 [--dry-run|--execute] SNAPSHOT_DIRECTORY" >&2
  exit 2
fi

for command in docker tar zstd gzip sha256sum find realpath jq cmp openssl sync mountpoint chown; do
  if ! command -v "$command" >/dev/null; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done

snapshot_dir="$(realpath -e "$snapshot_dir")"
if [[ ! -d "$snapshot_dir" || -L "$snapshot_dir" ]]; then
  echo "Snapshot must be a real directory: ${snapshot_dir}" >&2
  exit 1
fi
if [[ -e "$snapshot_dir/.incomplete" ]]; then
  echo "Snapshot is marked incomplete: ${snapshot_dir}" >&2
  exit 1
fi
for artifact in \
  SHA256SUMS \
  manifest.json \
  runtime-images.json \
  ssd.tar.zst \
  ssd-tree.tsv \
  ssd-files.sha256z \
  hdd.tar.zst \
  hdd-tree.tsv \
  hdd-files.sha256z \
  postgres.sql.gz \
  mongodb.archive.gz \
  redis-users.acl; do
  if [[ ! -f "$snapshot_dir/$artifact" || -L "$snapshot_dir/$artifact" ]]; then
    echo "Snapshot artifact is missing or unsafe: ${artifact}" >&2
    exit 1
  fi
done
if [[ "$(jq -r '.schemaVersion' "$snapshot_dir/manifest.json")" != "1" ]]; then
  echo "Unsupported snapshot manifest schema" >&2
  exit 1
fi

(
  cd "$snapshot_dir"
  sha256sum -c SHA256SUMS
)
zstd -q -t "$snapshot_dir/ssd.tar.zst"
zstd -q -t "$snapshot_dir/hdd.tar.zst"
gzip -t "$snapshot_dir/postgres.sql.gz"
gzip -t "$snapshot_dir/mongodb.archive.gz"
test -s "$snapshot_dir/redis-users.acl"

validate_archive_names() {
  local archive="$1"
  if tar -I zstd -tf "$archive" \
    | awk 'BEGIN { bad=0 } /^\// || /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad ? 0 : 1 }'; then
    echo "Archive contains an absolute or parent-traversing path: ${archive}" >&2
    exit 1
  fi
  if tar -I zstd -tvf "$archive" \
    | awk 'BEGIN { bad=0 } substr($0,1,1) == "l" || substr($0,1,1) == "h" { bad=1 } END { exit bad ? 0 : 1 }'; then
    echo "Archive contains a symlink or hard link: ${archive}" >&2
    exit 1
  fi
}

validate_archive_names "$snapshot_dir/ssd.tar.zst"
validate_archive_names "$snapshot_dir/hdd.tar.zst"

snapshot_id="$(jq -r '.snapshotId' "$snapshot_dir/manifest.json")"
ssd_bytes="$(jq -r '.branches.ssd.bytes' "$snapshot_dir/manifest.json")"
hdd_bytes="$(jq -r '.branches.hdd.bytes' "$snapshot_dir/manifest.json")"
postgres_image="$(jq -r '.[] | select(.name == "/deniz-cloud-postgres-1") | .configuredImage' "$snapshot_dir/runtime-images.json")"
mongo_image="$(jq -r '.[] | select(.name == "/deniz-cloud-mongodb-1") | .configuredImage' "$snapshot_dir/runtime-images.json")"
if [[ -z "$postgres_image" || "$postgres_image" == "null" || -z "$mongo_image" || "$mongo_image" == "null" ]]; then
  echo "Snapshot does not identify the production database images" >&2
  exit 1
fi

jq -n \
  --arg mode "$mode" \
  --arg snapshotId "$snapshot_id" \
  --arg postgresImage "$postgres_image" \
  --arg mongoImage "$mongo_image" \
  --argjson ssdBytes "$ssd_bytes" \
  --argjson hddBytes "$hdd_bytes" \
  '{mode:$mode,snapshotId:$snapshotId,branches:{ssdBytes:$ssdBytes,hddBytes:$hddBytes},databaseImages:{postgres:$postgresImage,mongodb:$mongoImage}}'

if [[ "$mode" == "--dry-run" ]]; then
  exit 0
fi
if (( EUID != 0 )); then
  echo "Restore verification requires root for disposable loopback mounts" >&2
  exit 1
fi
for command in losetup mkfs.ext4 mount umount truncate; do
  if ! command -v "$command" >/dev/null; then
    echo "Required restore command is missing: ${command}" >&2
    exit 1
  fi
done

work_parent="$(realpath -e "${POSIX_RESTORE_WORK_ROOT:-$(dirname "$snapshot_dir")}")"
work_dir="$(mktemp -d "${work_parent}/.posix-restore-proof.XXXXXX")"
postgres_restore="posix-restore-postgres-$$"
mongo_restore="posix-restore-mongodb-$$"
postgres_created=false
mongo_created=false
ssd_loop=""
hdd_loop=""
ssd_mount="$work_dir/ssd"
hdd_mount="$work_dir/hdd"

cleanup() {
  set +e
  [[ "$postgres_created" == "true" ]] && \
    docker rm --force --volumes "$postgres_restore" >/dev/null 2>&1
  [[ "$mongo_created" == "true" ]] && \
    docker rm --force --volumes "$mongo_restore" >/dev/null 2>&1
  mountpoint -q "$ssd_mount" && umount "$ssd_mount"
  mountpoint -q "$hdd_mount" && umount "$hdd_mount"
  [[ -n "$ssd_loop" ]] && losetup -d "$ssd_loop"
  [[ -n "$hdd_loop" ]] && losetup -d "$hdd_loop"
  if [[ "$work_dir" == "$work_parent/.posix-restore-proof."* ]]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

for restore_container in "$postgres_restore" "$mongo_restore"; do
  if docker inspect "$restore_container" >/dev/null 2>&1; then
    echo "Refusing to replace an existing restore container: ${restore_container}" >&2
    exit 1
  fi
done

mkdir "$ssd_mount" "$hdd_mount"
ssd_image="$work_dir/ssd.ext4"
hdd_image="$work_dir/hdd.ext4"
ssd_image_bytes=$((((ssd_bytes + ssd_bytes / 2 + 536870912 + 4095) / 4096) * 4096))
hdd_image_bytes=$((((hdd_bytes + hdd_bytes / 2 + 536870912 + 4095) / 4096) * 4096))
truncate -s "$ssd_image_bytes" "$ssd_image"
truncate -s "$hdd_image_bytes" "$hdd_image"
mkfs.ext4 -q -F "$ssd_image"
mkfs.ext4 -q -F "$hdd_image"
ssd_loop="$(losetup --find --show "$ssd_image")"
hdd_loop="$(losetup --find --show "$hdd_image")"
mount -o noatime "$ssd_loop" "$ssd_mount"
mount -o noatime "$hdd_loop" "$hdd_mount"
mkdir "$ssd_mount/namespace" "$hdd_mount/namespace"

restore_branch() {
  local label="$1"
  local target="$2"
  tar \
    --acls \
    --numeric-owner \
    --same-owner \
    --same-permissions \
    --sparse \
    --xattrs \
    --xattrs-include='*' \
    --keep-directory-symlink \
    -I zstd \
    -xf "$snapshot_dir/${label}.tar.zst" \
    -C "$target"
  sync -f "$target"
  (
    cd "$target"
    LC_ALL=C find . -xdev \
      -printf '%y\t%m\t%U\t%G\t%s\t%b\t%T@\t%p\t%l\n' \
      | LC_ALL=C sort > "$work_dir/${label}-tree.tsv"
    LC_ALL=C find . -xdev -type f -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 -r sha256sum --zero -- \
        > "$work_dir/${label}-files.sha256z"
  )
  for tree in source restored; do
    if [[ "$tree" == "source" ]]; then
      tree_input="$snapshot_dir/${label}-tree.tsv"
    else
      tree_input="$work_dir/${label}-tree.tsv"
    fi
    awk -F '\t' \
      '
        BEGIN { OFS=FS }
        $1 == "d" { $5="-"; $6="-" }
        $1 == "f" && $6 != "sparse" && $6 != "allocated" {
          $6=(($6 * 512) < $5 ? "sparse" : "allocated")
        }
        { print }
      ' \
      "$tree_input" \
      | LC_ALL=C sort > "$work_dir/${label}-${tree}-normalized.tsv"
  done
  cmp \
    "$work_dir/${label}-source-normalized.tsv" \
    "$work_dir/${label}-restored-normalized.tsv"
  cmp "$snapshot_dir/${label}-files.sha256z" "$work_dir/${label}-files.sha256z"
}

restore_branch ssd "$ssd_mount/namespace"
restore_branch hdd "$hdd_mount/namespace"

restore_password="$(openssl rand -hex 24)"
docker run --detach --pull never --network none \
  --name "$postgres_restore" \
  --env POSTGRES_PASSWORD="$restore_password" \
  --env POSTGRES_USER=restore \
  --env POSTGRES_DB=postgres \
  "$postgres_image" >/dev/null
postgres_created=true
for _ in {1..60}; do
  if docker exec "$postgres_restore" pg_isready -U restore -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$postgres_restore" pg_isready -U restore -d postgres >/dev/null
zcat "$snapshot_dir/postgres.sql.gz" \
  | docker exec -i "$postgres_restore" psql -v ON_ERROR_STOP=1 -U restore -d postgres >/dev/null
docker exec "$postgres_restore" psql -v ON_ERROR_STOP=1 -U restore -d denizcloud -Atc \
  'SELECT count(*) FROM files' > "$work_dir/restored-postgres-file-count"

docker run --detach --pull never --network none \
  --name "$mongo_restore" \
  "$mongo_image" --bind_ip_all >/dev/null
mongo_created=true
for _ in {1..60}; do
  if docker exec "$mongo_restore" mongosh --quiet --eval \
    'quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$mongo_restore" mongosh --quiet --eval \
  'quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)' >/dev/null
docker exec -i "$mongo_restore" mongorestore --archive --gzip >/dev/null \
  < "$snapshot_dir/mongodb.archive.gz"
docker exec "$mongo_restore" mongosh --quiet --eval \
  'const names=db.adminCommand({listDatabases:1}).databases.map(({name})=>name); if(names.length < 1) quit(1); print(names.length)' \
  > "$work_dir/restored-mongodb-database-count"

evidence_path="${POSIX_RESTORE_EVIDENCE:-${snapshot_dir}/restore-proof.json}"
if [[ -e "$evidence_path" || -e "${evidence_path}.partial" ]]; then
  echo "Refusing to overwrite restore evidence: ${evidence_path}" >&2
  exit 1
fi
jq -n \
  --arg snapshotId "$snapshot_id" \
  --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg checksumsSha256 "$(sha256sum "$snapshot_dir/SHA256SUMS" | awk '{print $1}')" \
  --argjson postgresFileCount "$(cat "$work_dir/restored-postgres-file-count")" \
  --argjson mongoDatabaseCount "$(cat "$work_dir/restored-mongodb-database-count")" \
  '{schemaVersion:1,snapshotId:$snapshotId,verifiedAt:$verifiedAt,checksumsManifestSha256:$checksumsSha256,filesystem:{ssd:{treeAndBytesMatch:true},hdd:{treeAndBytesMatch:true}},databases:{postgres:{restored:true,fileRows:$postgresFileCount},mongodb:{restored:true,databaseCount:$mongoDatabaseCount}}}' \
  > "${evidence_path}.partial"
mv "${evidence_path}.partial" "$evidence_path"
chown --reference="$snapshot_dir" "$evidence_path"
chmod 600 "$evidence_path"
sync -f "$(dirname "$evidence_path")"
cat "$evidence_path"
