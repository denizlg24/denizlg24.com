#!/bin/bash

set -euo pipefail

umask 077

readonly production_ssd_branch="/mnt/ssd/deniz-cloud/namespace"
readonly production_hdd_branch="/mnt/hdd/deniz-cloud/namespace"
readonly production_destination="/mnt/hdd/backups"
readonly branch_marker_name=".denizcloud-branch.json"

mode="--dry-run"
mode_set=false

usage() {
  cat >&2 <<'USAGE'
Usage: posix-namespace-backup.sh [--dry-run|--execute]

Backs up BOTH physical branches plus a namespace manifest.

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
destination="${POSIX_BACKUP_DESTINATION:-$production_destination}"

for path in "$ssd_branch" "$hdd_branch" "$destination"; do
  [[ "$path" == /* && "$path" != *$'\n'* ]] || {
    echo "Backup paths must be absolute and single-line" >&2
    exit 1
  }
done

for command in getfattr jq sha256sum tar; do
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
done

# tar must support xattrs, or protected identity is dropped without warning.
tar --help 2>/dev/null | grep -q -- --xattrs || {
  echo "tar does not support --xattrs; refusing to write a backup without identity" >&2
  exit 1
}

ssd_entries=$(find "$ssd_branch" -mindepth 1 \( -type f -o -type d \) | wc -l)
hdd_entries=$(find "$hdd_branch" -mindepth 1 \( -type f -o -type d \) | wc -l)

if [[ "$mode" == "--dry-run" ]]; then
  jq -n \
    --arg ssd "$ssd_branch" --arg hdd "$hdd_branch" --arg destination "$destination" \
    --argjson ssdEntries "$ssd_entries" --argjson hddEntries "$hdd_entries" \
    '{mode:"--dry-run",writes:false,branches:{ssd:$ssd,hdd:$hdd},
      destination:$destination,
      entries:{ssd:$ssdEntries,hdd:$hddEntries},
      preserves:["xattrs","acls","sparse","timestamps"],
      mergedViewOnly:false}'
  exit 0
fi

((EUID == 0)) || { echo "Execute mode requires root" >&2; exit 1; }
[[ -d "$destination" ]] || {
  echo "Backup destination does not exist: ${destination}" >&2
  exit 1
}

timestamp=$(date --utc +%Y%m%dT%H%M%SZ)
work="${destination}/posix-namespace-${timestamp}"
[[ ! -e "$work" ]] || { echo "Backup directory already exists: ${work}" >&2; exit 1; }
install -d -m 0700 "$work"

manifest="${work}/manifest.jsonl"
: > "$manifest"

emit_branch_manifest() {
  local branch="$1" role="$2" absolute relative kind size checksum hash key value canonical
  while IFS= read -r -d '' absolute; do
    relative="${absolute#"$branch"/}"
    [[ "$relative" != "$branch_marker_name" ]] || continue
    if [[ -d "$absolute" ]]; then kind=folder; size=0; checksum=""
    elif [[ -f "$absolute" ]]; then
      kind=file
      size=$(stat -c '%s' "$absolute")
      checksum=$(sha256sum "$absolute" | cut -d' ' -f1)
    else continue; fi
    canonical=""
    for key in checksum checksum_state created_at id mime_type owner_id schema_version scope; do
      value=$(getfattr --only-values -n "security.denizcloud.${key}" -- "$absolute" 2>/dev/null || true)
      [[ -n "$value" ]] || continue
      canonical+="security.denizcloud.${key}=${value}"$'\n'
    done
    hash=$(printf '%s' "$canonical" | sha256sum | cut -d' ' -f1)
    jq -cn --arg role "$role" --arg relative "$relative" --arg kind "$kind" \
      --arg checksum "$checksum" --arg hash "$hash" \
      --arg id "$(getfattr --only-values -n security.denizcloud.id -- "$absolute" 2>/dev/null || true)" \
      --argjson size "$size" \
      '{branch:$role,relativePath:$relative,kind:$kind,sizeBytes:$size,
        checksum:(if $checksum=="" then null else $checksum end),
        id:(if $id=="" then null else $id end),
        protectedXattrHash:$hash}' >> "$manifest"
  done < <(find "$branch" -mindepth 1 -print0 | sort -z)
}

emit_branch_manifest "$ssd_branch" ssd
emit_branch_manifest "$hdd_branch" hdd

for pair in "ssd:$ssd_branch" "hdd:$hdd_branch"; do
  role="${pair%%:*}"; branch="${pair#*:}"
  tar --xattrs --xattrs-include='security.*' --xattrs-include='user.*' \
    --acls --sparse --numeric-owner --sort=name \
    -C "$branch" -cf - . | zstd -T0 -3 -o "${work}/${role}.tar.zst" -q
done

(cd "$work" && sha256sum ./*.tar.zst manifest.jsonl > SHA256SUMS)
jq -n --arg at "$(date --utc +%FT%TZ)" --arg timestamp "$timestamp" \
  --argjson ssdEntries "$ssd_entries" --argjson hddEntries "$hdd_entries" \
  '{schemaVersion:1,createdAt:$at,backupId:("posix-namespace-" + $timestamp),
    branchesIncluded:["ssd","hdd"],mergedViewOnly:false,
    preserves:["xattrs","acls","sparse","timestamps"],
    entries:{ssd:$ssdEntries,hdd:$hddEntries}}' > "${work}/backup.json"
chmod 0600 "$work"/*

jq -n --arg directory "$work" --argjson manifestEntries "$(wc -l < "$manifest")" \
  '{backedUp:true,directory:$directory,manifestEntries:$manifestEntries,
    branchesIncluded:["ssd","hdd"],verifyWith:"posix-namespace-restore-verify.sh"}'
