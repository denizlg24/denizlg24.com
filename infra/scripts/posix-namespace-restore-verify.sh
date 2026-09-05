#!/bin/bash

set -euo pipefail

umask 077

backup_dir=""
ssd_root=""
hdd_root=""
object_root=""

usage() {
  cat >&2 <<'USAGE'
Usage: posix-namespace-restore-verify.sh --backup DIR [--ssd-root DIR --hdd-root DIR --object-root DIR]

Restores a namespace backup into disposable directories and compares the result
against its manifest: every id, path, branch, size, checksum and protected
metadata hash must match exactly.

This is a bare restore. It never touches the live namespace, and it is the only
thing that turns "a backup exists" into "a backup restores" — an archive that
silently dropped xattrs looks identical to a good one until the day it is
needed.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --backup)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      backup_dir="$2"; shift 2 ;;
    --ssd-root) [[ $# -ge 2 ]] || { usage; exit 2; }; ssd_root="$2"; shift 2 ;;
    --hdd-root) [[ $# -ge 2 ]] || { usage; exit 2; }; hdd_root="$2"; shift 2 ;;
    --object-root) [[ $# -ge 2 ]] || { usage; exit 2; }; object_root="$2"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n "$backup_dir" && "$backup_dir" == /* && "$backup_dir" != / && "$backup_dir" != */ ]] || { usage; exit 2; }
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] || { echo "No safe backup directory: ${backup_dir}" >&2; exit 1; }
[[ -z "$ssd_root" && -z "$hdd_root" && -z "$object_root" ||
   -n "$ssd_root" && -n "$hdd_root" && -n "$object_root" ]] || { usage; exit 2; }
for root in "$ssd_root" "$hdd_root" "$object_root"; do
  [[ -z "$root" || "$root" == /* && "$root" != / && "$root" != */ && -d "$root" && ! -L "$root" ]] \
    || { echo "Unsafe restored root: ${root}" >&2; exit 1; }
done

for command in getfacl getfattr jq sha256sum stat tar zstd; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done

manifest="${backup_dir}/manifest.jsonl"
[[ -f "$manifest" && ! -L "$manifest" ]] || { echo "Backup has no safe manifest" >&2; exit 1; }
# Branch archives became plain tar when compression was found to be defeating
# restic deduplication. Snapshots written before that carry `.tar.zst`, and they
# stay restorable for the length of the retention window, so both names resolve
# here rather than the older backups becoming unverifiable.
branch_archive() {
  local role="$1" candidate
  for candidate in "${backup_dir}/${role}.tar" "${backup_dir}/${role}.tar.zst"; do
    [[ -f "$candidate" && ! -L "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
  done
  return 1
}
for required_file in SHA256SUMS backup.json; do
  [[ -f "$backup_dir/$required_file" && ! -L "$backup_dir/$required_file" ]] \
    || { echo "Backup member is missing or unsafe: ${required_file}" >&2; exit 1; }
done
for role in ssd hdd object-store; do
  branch_archive "$role" >/dev/null \
    || { echo "Backup member is missing or unsafe: ${role}.tar" >&2; exit 1; }
done
jq -e '
  .schemaVersion==1 and (.backupId|test("^posix-namespace-[0-9]{8}T[0-9]{6}Z$")) and
  .branchesIncluded==["ssd","hdd"] and .objectStoreIncluded==true and .mergedViewOnly==false and
  .preserves==["xattrs","acls","sparse","timestamps"] and
  (.entries.ssd|type)=="number" and .entries.ssd>=0 and (.entries.ssd|floor)==.entries.ssd and
  (.entries.hdd|type)=="number" and .entries.hdd>=0 and (.entries.hdd|floor)==.entries.hdd and
  (.entries.objectStore|type)=="number" and .entries.objectStore>=0 and (.entries.objectStore|floor)==.entries.objectStore
' "$backup_dir/backup.json" >/dev/null || { echo "Backup metadata is invalid" >&2; exit 1; }

jq -e -s '
  length > 0 and
  all(.[];
    (.branch=="ssd" or .branch=="hdd" or .branch=="object-store") and
    (.relativePath|type)=="string" and (.relativePath|length)>0 and
    (.kind=="file" or .kind=="folder") and
    (.sizeBytes|type)=="number" and .sizeBytes>=0 and (.sizeBytes|floor)==.sizeBytes and
    (.uid|type)=="number" and .uid>=0 and (.uid|floor)==.uid and
    (.gid|type)=="number" and .gid>=0 and (.gid|floor)==.gid and
    (.mode|type)=="string" and (.mode|test("^[0-7]{3,4}$")) and
    (.protectedXattrHash|type)=="string" and (.protectedXattrHash|test("^[0-9a-f]{64}$")) and
    (.aclHash|type)=="string" and (.aclHash|test("^[0-9a-f]{64}$")) and
    (.mtimeEpoch|type)=="number" and (.mtimeEpoch|floor)==.mtimeEpoch and
    (if .kind=="file" then (.checksum|type)=="string" and (.checksum|test("^[0-9a-f]{64}$")) else .checksum==null end)
  ) and
  ([.[] | [.branch,.relativePath]] | unique | length)==length
' "$manifest" >/dev/null || { echo "Backup manifest has an invalid or duplicate entry" >&2; exit 1; }
jq -e --slurpfile manifest "$manifest" '
  .entries.ssd==([$manifest[] | select(.branch=="ssd")]|length) and
  .entries.hdd==([$manifest[] | select(.branch=="hdd")]|length) and
  .entries.objectStore==([$manifest[] | select(.branch=="object-store")]|length)
' "$backup_dir/backup.json" >/dev/null || { echo "Backup metadata entry counts do not match its manifest" >&2; exit 1; }

(cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null) || {
  echo "Backup checksums failed" >&2
  exit 1
}

work=""
if [[ -z "$ssd_root" ]]; then
  work="$(mktemp -d "${TMPDIR:-/var/tmp}/posix-restore-verify.XXXXXX")"
  cleanup() { rm -rf -- "$work"; }
  trap cleanup EXIT
  for role in ssd hdd object-store; do
    install -d -m 0700 "${work}/${role}"
    archive="$(branch_archive "$role")"
    if [[ "$archive" == *.zst ]]; then
      zstd -dc "$archive" \
        | tar --xattrs --xattrs-include='security.*' --xattrs-include='user.*' \
            --acls --numeric-owner --sparse -C "${work}/${role}" -xf -
    else
      tar --xattrs --xattrs-include='security.*' --xattrs-include='user.*' \
        --acls --numeric-owner --sparse -C "${work}/${role}" -xf "$archive"
    fi
  done
  ssd_root="${work}/ssd"
  hdd_root="${work}/hdd"
  object_root="${work}/object-store"
fi

for restored_root in "$ssd_root" "$hdd_root" "$object_root"; do
  unexpected_entry=$(find "$restored_root" -mindepth 1 ! -type f ! -type d -print -quit)
  [[ -z "$unexpected_entry" ]] || {
    echo "Restored namespace contains an unsupported symlink or special entry: ${unexpected_entry}" >&2
    exit 1
  }
done

mismatches=0
checked=0
report() {
  mismatches=$((mismatches + 1))
  [[ "$mismatches" -gt 20 ]] || echo "MISMATCH ${1}: ${2}" >&2
}

while IFS= read -r line; do
  branch=$(jq -r '.branch' <<< "$line")
  relative=$(jq -r '.relativePath' <<< "$line")
  kind=$(jq -r '.kind' <<< "$line")
  expected_id=$(jq -r '.id // empty' <<< "$line")
  expected_checksum=$(jq -r '.checksum // empty' <<< "$line")
  expected_hash=$(jq -r '.protectedXattrHash' <<< "$line")
  expected_size=$(jq -r '.sizeBytes' <<< "$line")
  [[ "$relative" == . || "$relative" != /* && "$relative" != *$'\n'* &&
     "/${relative}/" != *'/../'* && "/${relative}/" != *'/./'* ]] \
    || { echo "Unsafe namespace manifest path" >&2; exit 1; }
  case "$branch" in
    ssd) restored="$ssd_root" ;;
    hdd) restored="$hdd_root" ;;
    object-store) restored="$object_root" ;;
    *) echo "Unsafe namespace manifest branch" >&2; exit 1 ;;
  esac
  [[ "$relative" == . ]] || restored="${restored}/${relative}"
  checked=$((checked + 1))

  if [[ "$kind" == folder ]]; then
    [[ -d "$restored" ]] || { report missing-folder "$relative"; continue; }
  else
    [[ -f "$restored" ]] || { report missing-file "$relative"; continue; }
    [[ "$(stat -c '%s' "$restored")" == "$expected_size" ]] \
      || report size "$relative"
    [[ "$(sha256sum "$restored" | cut -d' ' -f1)" == "$expected_checksum" ]] \
      || report checksum "$relative"
  fi

  actual_id=$(getfattr --only-values -n security.denizcloud.id -- "$restored" 2>/dev/null || true)
  [[ "$actual_id" == "$expected_id" ]] || report identity "$relative"

  canonical=""
  for key in checksum checksum_state created_at id mime_type owner_id schema_version scope; do
    value=$(getfattr --only-values -n "security.denizcloud.${key}" -- "$restored" 2>/dev/null || true)
    [[ -n "$value" ]] || continue
    canonical+="security.denizcloud.${key}=${value}"$'\n'
  done
  actual_hash=$(printf '%s' "$canonical" | sha256sum | cut -d' ' -f1)
  # The decisive check: an archive that dropped xattrs restores bytes perfectly
  # and identity not at all, and only this comparison notices.
  [[ "$actual_hash" == "$expected_hash" ]] || report protected-metadata "$relative"
  expected_uid=$(jq -r '.uid // empty' <<< "$line")
  expected_gid=$(jq -r '.gid // empty' <<< "$line")
  expected_mode=$(jq -r '.mode // empty' <<< "$line")
  expected_acl=$(jq -r '.aclHash // empty' <<< "$line")
  expected_sparse=$(jq -r '.sparse // false' <<< "$line")
  expected_mtime=$(jq -r '.mtimeEpoch' <<< "$line")
  [[ -z "$expected_uid" || "$(stat -c '%u' "$restored")" == "$expected_uid" ]] || report uid "$relative"
  [[ -z "$expected_gid" || "$(stat -c '%g' "$restored")" == "$expected_gid" ]] || report gid "$relative"
  [[ -z "$expected_mode" || "$(stat -c '%a' "$restored")" == "$expected_mode" ]] || report mode "$relative"
  [[ "$(stat -c '%Y' "$restored")" == "$expected_mtime" ]] || report mtime "$relative"
  actual_acl=$(getfacl -cp -- "$restored" | sha256sum | cut -d' ' -f1)
  [[ -z "$expected_acl" || "$actual_acl" == "$expected_acl" ]] || report acl "$relative"
  if [[ "$expected_sparse" == true ]]; then
    actual_allocated=$(( $(stat -c '%b' "$restored") * 512 ))
    [[ "$actual_allocated" -lt "$expected_size" ]] || report sparse-extents "$relative"
  fi
done < "$manifest"

for role in ssd hdd object-store; do
  case "$role" in
    ssd) restored_root="$ssd_root" ;;
    hdd) restored_root="$hdd_root" ;;
    object-store) restored_root="$object_root" ;;
  esac
  expected_count=$(jq -s --arg role "$role" '[.[] | select(.branch==$role)] | length' "$manifest")
  actual_count=$(( $(find "$restored_root" -mindepth 1 \( -type f -o -type d \) | wc -l) + 1 ))
  [[ "$actual_count" == "$expected_count" ]] || report entry-count "$role expected=${expected_count} actual=${actual_count}"
done

jq -n --arg backup "$backup_dir" --argjson checked "$checked" \
  --argjson mismatches "$mismatches" \
  '{verified:($mismatches == 0),backup:$backup,entriesChecked:$checked,
    mismatches:$mismatches,liveNamespaceTouched:false}'

[[ "$mismatches" -eq 0 ]] || exit 1
