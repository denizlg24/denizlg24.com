#!/bin/bash

set -euo pipefail

umask 077

backup_dir=""

usage() {
  cat >&2 <<'USAGE'
Usage: posix-namespace-restore-verify.sh --backup DIR

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
    *) usage; exit 2 ;;
  esac
done

[[ -n "$backup_dir" && "$backup_dir" == /* ]] || { usage; exit 2; }
[[ -d "$backup_dir" ]] || { echo "No such backup: ${backup_dir}" >&2; exit 1; }

for command in getfattr jq sha256sum tar zstd; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done

manifest="${backup_dir}/manifest.jsonl"
[[ -f "$manifest" ]] || { echo "Backup has no manifest" >&2; exit 1; }

(cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null) || {
  echo "Backup checksums failed" >&2
  exit 1
}

work="$(mktemp -d "${TMPDIR:-/var/tmp}/posix-restore-verify.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

for role in ssd hdd; do
  install -d -m 0700 "${work}/${role}"
  zstd -dc "${backup_dir}/${role}.tar.zst" \
    | tar --xattrs --xattrs-include='security.*' --xattrs-include='user.*' \
        --acls --numeric-owner -C "${work}/${role}" -xf -
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
  restored="${work}/${branch}/${relative}"
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
done < "$manifest"

jq -n --arg backup "$backup_dir" --argjson checked "$checked" \
  --argjson mismatches "$mismatches" \
  '{verified:($mismatches == 0),backup:$backup,entriesChecked:$checked,
    mismatches:$mismatches,liveNamespaceTouched:false}'

[[ "$mismatches" -eq 0 ]] || exit 1
