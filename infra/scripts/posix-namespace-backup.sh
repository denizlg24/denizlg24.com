#!/bin/bash

set -euo pipefail

umask 077

readonly production_ssd_branch="/mnt/ssd/deniz-cloud/namespace"
readonly production_hdd_branch="/mnt/hdd/deniz-cloud/namespace"
readonly production_object_store="/mnt/ssd/deniz-cloud/internal/.s3-v2"

# Reserved directory name for deep-health canaries. The storage synthetics
# create and delete a file continuously — the public deep-dependency monitor
# calls them every three minutes — while this archive takes far longer than
# that. Any canary path, or any directory whose mtime one of them moves, makes
# the before/after inventory differ and the backup refuse itself as
# inconsistent, forever. They hold no data, so they are pruned from the
# inventories, the entry counts and the archive alike.
readonly synthetic_dir_name=".dr-synthetic"
readonly production_destination="/mnt/hdd/backups"
readonly branch_marker_name=".denizcloud-branch.json"

mode="--dry-run"
mode_set=false

usage() {
  cat >&2 <<'USAGE'
Usage: posix-namespace-backup.sh [--dry-run|--execute]

Backs up both physical namespace branches and the authoritative project S3
object tree, plus one exact metadata manifest.

A merged-view backup is insufficient: the merged view hides which branch holds
a path, so a restore from it cannot reproduce tier placement and cannot
diagnose a branch duplicate. Each branch is archived separately and the
manifest records every entry's id, path, branch, size, checksum and protected
metadata hash so a restore can be verified rather than assumed.

Archives preserve extended attributes, ACLs and sparseness. Without --xattrs
the protected security.denizcloud.* metadata is silently dropped and the
restored namespace has bytes but no identity.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --dry-run | --execute)
      [[ "$mode_set" == false ]] || { usage; exit 2; }
      mode="$1"; mode_set=true; shift ;;
    *) usage; exit 2 ;;
  esac
done

ssd_branch="${POSIX_BACKUP_SSD_BRANCH:-$production_ssd_branch}"
hdd_branch="${POSIX_BACKUP_HDD_BRANCH:-$production_hdd_branch}"
object_store="${POSIX_BACKUP_OBJECT_STORE:-$production_object_store}"
destination="${POSIX_BACKUP_DESTINATION:-$production_destination}"

for path in "$ssd_branch" "$hdd_branch" "$object_store" "$destination"; do
  [[ "$path" == /* && "$path" != / && "$path" != */ && "$path" != *$'\n'* ]] || {
    echo "Backup paths must be normalized, absolute, non-root, and single-line" >&2
    exit 1
  }
done

[[ -d "$object_store" && ! -L "$object_store" ]] || {
  echo "Authoritative object store is missing or unsafe: ${object_store}" >&2
  exit 1
}
unexpected_entry=$(find "$object_store" -mindepth 1 \( -name "$synthetic_dir_name" -prune \) -o \( ! -type f ! -type d -print -quit \))
[[ -z "$unexpected_entry" ]] || {
  echo "Object store contains an unsupported symlink or special entry: ${unexpected_entry}" >&2
  exit 1
}

for command in cmp find getfacl getfattr jq sha256sum stat tar zstd; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done

for branch in "$ssd_branch" "$hdd_branch"; do
  [[ -d "$branch" && ! -L "$branch" ]] || {
    echo "Branch is missing or unsafe: ${branch}" >&2
    exit 1
  }
  # Backing up an unmounted branch would archive an empty directory and the
  # result would restore as mass deletion.
  [[ -f "${branch}/${branch_marker_name}" && ! -L "${branch}/${branch_marker_name}" ]] || {
    echo "Branch marker is missing, refusing to back up: ${branch}" >&2
    exit 1
  }
  unexpected_entry=$(find "$branch" -mindepth 1 \( -name "$synthetic_dir_name" -prune \) -o \( ! -type f ! -type d -print -quit \))
  [[ -z "$unexpected_entry" ]] || {
    echo "Namespace contains an unsupported symlink or special entry: ${unexpected_entry}" >&2
    exit 1
  }
done

# tar must support xattrs, or protected identity is dropped without warning.
tar --help 2>/dev/null | grep -q -- --xattrs || {
  echo "tar does not support --xattrs; refusing to write a backup without identity" >&2
  exit 1
}

ssd_entries=$(( $(find "$ssd_branch" -mindepth 1 \( -name "$synthetic_dir_name" -prune \) -o \( -type f -o -type d \) -print | wc -l) + 1 ))
hdd_entries=$(( $(find "$hdd_branch" -mindepth 1 \( -name "$synthetic_dir_name" -prune \) -o \( -type f -o -type d \) -print | wc -l) + 1 ))
object_entries=$(( $(find "$object_store" -mindepth 1 \( -name "$synthetic_dir_name" -prune \) -o \( -type f -o -type d \) -print | wc -l) + 1 ))

if [[ "$mode" == "--dry-run" ]]; then
  jq -n \
    --arg ssd "$ssd_branch" --arg hdd "$hdd_branch" --arg objectStore "$object_store" --arg destination "$destination" \
    --argjson ssdEntries "$ssd_entries" --argjson hddEntries "$hdd_entries" --argjson objectEntries "$object_entries" \
    '{mode:"--dry-run",writes:false,branches:{ssd:$ssd,hdd:$hdd},objectStore:$objectStore,
      destination:$destination,
      entries:{ssd:$ssdEntries,hdd:$hddEntries,objectStore:$objectEntries},
      preserves:["xattrs","acls","sparse","timestamps"],
      mergedViewOnly:false}'
  exit 0
fi

((EUID == 0)) || { echo "Execute mode requires root" >&2; exit 1; }
[[ -d "$destination" ]] || {
  echo "Backup destination does not exist: ${destination}" >&2
  exit 1
}
[[ ! -L "$destination" ]] || { echo "Backup destination is a symlink" >&2; exit 1; }

timestamp=$(date --utc +%Y%m%dT%H%M%SZ)
work="${destination}/posix-namespace-${timestamp}"
[[ ! -e "$work" ]] || { echo "Backup directory already exists: ${work}" >&2; exit 1; }
install -d -m 0700 "$work"
completed=false
cleanup() {
  local status=$?
  if [[ "$completed" != true && -d "$work" && ! -L "$work" && "$work" == "$destination"/posix-namespace-* ]]; then
    rm -rf -- "$work"
  fi
  exit "$status"
}
trap cleanup EXIT

manifest="${work}/manifest.jsonl"
manifest_after="${work}/manifest.after.jsonl"

emit_branch_manifest() {
  local branch="$1" role="$2" output="$3" paths="$4" absolute relative kind size checksum hash key value canonical acl_hash
  local uid gid mode allocated sparse mtime
  : > "$paths"
  while IFS= read -r -d '' absolute; do
    if [[ "$absolute" == "$branch" ]]; then relative=.; else relative="${absolute#"$branch"/}"; fi
    [[ "$relative" == . || "$relative" != /* && "$relative" != *$'\n'* &&
       "/${relative}/" != *'/../'* && "/${relative}/" != *'/./'* ]] || {
      echo "Namespace contains an unsafe path: ${relative}" >&2
      return 1
    }
    [[ ! -L "$absolute" ]] || {
      echo "Namespace contains an unsupported symlink: ${absolute}" >&2
      return 1
    }
    if [[ -d "$absolute" ]]; then kind=folder; size=0; checksum=""
    elif [[ -f "$absolute" ]]; then
      kind="file"
      size=$(stat -c '%s' "$absolute")
      checksum=$(sha256sum "$absolute" | cut -d' ' -f1)
    else
      echo "Namespace contains an unsupported special entry: ${absolute}" >&2
      return 1
    fi
    if [[ "$relative" == . ]]; then printf '.\0' >> "$paths"; else printf './%s\0' "$relative" >> "$paths"; fi
    canonical=""
    for key in checksum checksum_state created_at id mime_type owner_id schema_version scope; do
      value=$(getfattr --only-values -n "security.denizcloud.${key}" -- "$absolute" 2>/dev/null || true)
      [[ -n "$value" ]] || continue
      canonical+="security.denizcloud.${key}=${value}"$'\n'
    done
    hash=$(printf '%s' "$canonical" | sha256sum | cut -d' ' -f1)
    uid=$(stat -c '%u' "$absolute"); gid=$(stat -c '%g' "$absolute")
    mode=$(stat -c '%a' "$absolute"); mtime=$(stat -c '%Y' "$absolute")
    allocated=$(( $(stat -c '%b' "$absolute") * 512 ))
    sparse=false
    [[ "$kind" == file && "$size" -gt 0 && "$allocated" -lt "$size" ]] && sparse=true
    acl_hash=$(getfacl -cp -- "$absolute" | sha256sum | cut -d' ' -f1)
    jq -cn --arg role "$role" --arg relative "$relative" --arg kind "$kind" \
      --arg checksum "$checksum" --arg hash "$hash" --arg aclHash "$acl_hash" \
      --arg id "$(getfattr --only-values -n security.denizcloud.id -- "$absolute" 2>/dev/null || true)" \
      --argjson size "$size" --argjson uid "$uid" --argjson gid "$gid" \
      --arg mode "$mode" --argjson allocated "$allocated" --argjson sparse "$sparse" --argjson mtime "$mtime" \
      '{branch:$role,relativePath:$relative,kind:$kind,sizeBytes:$size,
        checksum:(if $checksum=="" then null else $checksum end),
        id:(if $id=="" then null else $id end),
        protectedXattrHash:$hash,uid:$uid,gid:$gid,mode:$mode,aclHash:$aclHash,
        allocatedBytes:$allocated,sparse:$sparse,mtimeEpoch:$mtime}' >> "$output"
  done < <(printf '%s\0' "$branch"; find "$branch" -mindepth 1 \( -name "$synthetic_dir_name" -prune \) -o -print0 | sort -z)
}

: > "$manifest"
emit_branch_manifest "$ssd_branch" ssd "$manifest" "$work/ssd.paths"
emit_branch_manifest "$hdd_branch" hdd "$manifest" "$work/hdd.paths"
emit_branch_manifest "$object_store" object-store "$manifest" "$work/object-store.paths"
ssd_entries=$(jq -s '[.[] | select(.branch=="ssd")] | length' "$manifest")
hdd_entries=$(jq -s '[.[] | select(.branch=="hdd")] | length' "$manifest")
object_entries=$(jq -s '[.[] | select(.branch=="object-store")] | length' "$manifest")

# These archives are deliberately uncompressed. restic deduplicates the
# repository by content-defined chunking, and a zstd stream re-encodes globally
# when any input byte changes, so a compressed archive shares no chunks with the
# run before it: two snapshots of one 73 GiB namespace cost 146 GiB, and the
# repository grew by a full copy every six hours until it was measured. The
# namespace is already-compressed media, so zstd returned 1.00x here anyway.
# Writing plain tar gives up no space and lets restic store only what changed.
for pair in "ssd:$ssd_branch" "hdd:$hdd_branch" "object-store:$object_store"; do
  role="${pair%%:*}"; branch="${pair#*:}"
  tar --xattrs --xattrs-include='security.*' --xattrs-include='user.*' \
    --acls --sparse --numeric-owner --sort=name --null --no-recursion \
    -C "$branch" -T "$work/${role}.paths" -cf "${work}/${role}.tar"
done

# The namespace is live and the underlying filesystems do not provide a common
# snapshot primitive. A second complete inventory turns concurrent writes into
# a failed backup instead of publishing a manifest that does not describe the
# archive. The host-level DR lock prevents another backup from racing this one;
# application writes are detected by this comparison.
: > "$manifest_after"
emit_branch_manifest "$ssd_branch" ssd "$manifest_after" "$work/ssd.after.paths"
emit_branch_manifest "$hdd_branch" hdd "$manifest_after" "$work/hdd.after.paths"
emit_branch_manifest "$object_store" object-store "$manifest_after" "$work/object-store.after.paths"
cmp -s "$manifest" "$manifest_after" || {
  echo "Namespace changed while it was archived; refusing an inconsistent backup" >&2
  exit 1
}
if ! cmp -s "$work/ssd.paths" "$work/ssd.after.paths" \
  || ! cmp -s "$work/hdd.paths" "$work/hdd.after.paths" \
  || ! cmp -s "$work/object-store.paths" "$work/object-store.after.paths"; then
  echo "Namespace path inventory changed while it was archived; refusing an inconsistent backup" >&2
  exit 1
fi
rm -f -- "$manifest_after" "$work/ssd.paths" "$work/hdd.paths" "$work/object-store.paths" \
  "$work/ssd.after.paths" "$work/hdd.after.paths" "$work/object-store.after.paths"

jq -n --arg at "$(date --utc +%FT%TZ)" --arg timestamp "$timestamp" \
  --argjson ssdEntries "$ssd_entries" --argjson hddEntries "$hdd_entries" --argjson objectEntries "$object_entries" \
  '{schemaVersion:1,createdAt:$at,backupId:("posix-namespace-" + $timestamp),
    branchesIncluded:["ssd","hdd"],objectStoreIncluded:true,mergedViewOnly:false,
    preserves:["xattrs","acls","sparse","timestamps"],
    entries:{ssd:$ssdEntries,hdd:$hddEntries,objectStore:$objectEntries}}' > "${work}/backup.json"
(cd "$work" && sha256sum ./*.tar manifest.jsonl backup.json > SHA256SUMS)
chmod 0600 "$work"/*

result=$(jq -n --arg directory "$work" --argjson manifestEntries "$(wc -l < "$manifest")" \
  '{backedUp:true,directory:$directory,manifestEntries:$manifestEntries,
    branchesIncluded:["ssd","hdd"],objectStoreIncluded:true,verifyWith:"posix-namespace-restore-verify.sh"}')
completed=true
printf '%s\n' "$result"
