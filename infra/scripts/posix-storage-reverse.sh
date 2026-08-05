#!/bin/bash

set -euo pipefail

umask 077

readonly production_source_ssd="/mnt/ssd/deniz-cloud/namespace"
readonly production_source_hdd="/mnt/hdd/deniz-cloud/namespace"
readonly production_target_ssd="/mnt/ssd/deniz-cloud/reverse/storage"
readonly production_target_hdd="/mnt/hdd/deniz-cloud/reverse/storage"
readonly production_journal_root="/var/lib/deniz-cloud/posix-migration"
readonly branch_marker_name=".denizcloud-branch.json"
readonly witness_name=".denizcloud-mount-witness"
# Must equal PROTECTED_XATTR_NAMESPACE in
# packages/cloud-core/src/storage/metadata.ts; posix-xattr-namespace.test.ts
# fails if they drift.
readonly xattr_ns="user."

mode="--dry-run"
mode_set=false
snapshot_id=""
manifest_path=""

usage() {
  cat >&2 <<'USAGE'
Usage: posix-storage-reverse.sh [--dry-run|--execute]
       --snapshot-id SNAPSHOT_ID [--manifest PATH]

Reconstructs the legacy DB-authoritative layout from the POSIX namespace so
writes accepted after cutover can be rolled back. The namespace is read-only
throughout and the retained legacy roots are never touched: the export builds a
separate pair of roots the operator swaps in deliberately.

Dry-run is the default. It walks and validates both branches without writing
anything except the manifest, and only when --manifest is given.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --dry-run | --execute)
      if [[ "$mode_set" == "true" ]]; then
        usage
        exit 2
      fi
      mode="$1"
      mode_set=true
      shift
      ;;
    --snapshot-id)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      snapshot_id="$2"
      shift 2
      ;;
    --manifest)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      manifest_path="$2"
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ -n "$snapshot_id" ]] || { usage; exit 2; }
if [[ ! "$snapshot_id" =~ ^posix-gate0-[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "Snapshot ID must be an exact Gate 0 snapshot ID" >&2
  exit 1
fi
if [[ "${POSIX_REVERSE_CURRENT_SNAPSHOT_ID:-}" != "$snapshot_id" ]]; then
  echo "Snapshot ID must match POSIX_REVERSE_CURRENT_SNAPSHOT_ID" >&2
  exit 1
fi

for command in getfattr jq realpath sha256sum stat; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done

source_ssd="${POSIX_REVERSE_SOURCE_SSD:-$production_source_ssd}"
source_hdd="${POSIX_REVERSE_SOURCE_HDD:-$production_source_hdd}"
target_ssd="${POSIX_REVERSE_TARGET_SSD:-$production_target_ssd}"
target_hdd="${POSIX_REVERSE_TARGET_HDD:-$production_target_hdd}"
journal_path="${POSIX_REVERSE_JOURNAL:-${production_journal_root}/${snapshot_id}.reverse.journal.jsonl}"

declared_paths=("$source_ssd" "$source_hdd" "$target_ssd" "$target_hdd" "$journal_path")
[[ -z "$manifest_path" ]] || declared_paths+=("$manifest_path")
for path in "${declared_paths[@]}"; do
  [[ "$path" == /* && "$path" != *$'\n'* ]] || {
    echo "Reverse migration paths must be absolute and single-line" >&2
    exit 1
  }
done

if [[ "$mode" != "--dry-run" ]]; then
  if ((EUID != 0)); then
    echo "${mode} requires root" >&2
    exit 1
  fi
  if [[ "$source_ssd" != "$production_source_ssd" \
    || "$source_hdd" != "$production_source_hdd" \
    || "$target_ssd" != "$production_target_ssd" \
    || "$target_hdd" != "$production_target_hdd" \
    || "$journal_path" != "${production_journal_root}/${snapshot_id}.reverse.journal.jsonl" ]]; then
    echo "${mode} requires the exact production storage path allowlist" >&2
    exit 1
  fi
fi

for path in "$source_ssd" "$source_hdd" "$target_ssd" "$target_hdd"; do
  [[ -d "$path" && ! -L "$path" ]] || {
    echo "Required reverse migration root is missing or unsafe: ${path}" >&2
    exit 1
  }
done

source_ssd="$(realpath "$source_ssd")"
source_hdd="$(realpath "$source_hdd")"
target_ssd="$(realpath "$target_ssd")"
target_hdd="$(realpath "$target_hdd")"
journal_parent="$(dirname "$journal_path")"
[[ -d "$journal_parent" ]] || {
  echo "Reverse journal parent must already exist" >&2
  exit 1
}
journal_path="$(realpath "$journal_parent")/$(basename "$journal_path")"

if [[ "$mode" != "--dry-run" \
  && ( "$source_ssd" != "$production_source_ssd" \
    || "$source_hdd" != "$production_source_hdd" \
    || "$target_ssd" != "$production_target_ssd" \
    || "$target_hdd" != "$production_target_hdd" \
    || "$journal_path" != "${production_journal_root}/${snapshot_id}.reverse.journal.jsonl" ) ]]; then
  echo "${mode} production paths must not resolve through symlinks" >&2
  exit 1
fi

roots=("$source_ssd" "$source_hdd" "$target_ssd" "$target_hdd")
for ((left = 0; left < ${#roots[@]}; left++)); do
  [[ "${roots[$left]}" != "/" ]] || {
    echo "Reverse migration roots must be below /" >&2
    exit 1
  }
  for ((right = left + 1; right < ${#roots[@]}; right++)); do
    if [[ "${roots[$left]}" == "${roots[$right]}" \
      || "${roots[$left]}" == "${roots[$right]}/"* \
      || "${roots[$right]}" == "${roots[$left]}/"* ]]; then
      echo "Reverse migration roots must be distinct and non-overlapping" >&2
      exit 1
    fi
  done
done

for root in "${roots[@]}"; do
  if [[ "$journal_path" == "$root" || "$journal_path" == "$root/"* ]]; then
    echo "Reverse journal must stay outside every migration root" >&2
    exit 1
  fi
  if [[ -n "$manifest_path" && ( "$manifest_path" == "$root" || "$manifest_path" == "$root/"* ) ]]; then
    echo "Reverse manifest must stay outside every migration root" >&2
    exit 1
  fi
done

branch_uuid() {
  local tier="$1" root="$2" configured=""
  if [[ "$tier" == "ssd" ]]; then
    configured="${POSIX_REVERSE_SSD_UUID:-}"
  else
    configured="${POSIX_REVERSE_HDD_UUID:-}"
  fi
  if [[ -n "$configured" ]]; then
    if [[ "$mode" != "--dry-run" ]]; then
      echo "Filesystem UUID overrides are dry-run only" >&2
      return 1
    fi
    printf '%s\n' "$configured"
    return
  fi
  command -v findmnt >/dev/null && command -v blkid >/dev/null || {
    echo "findmnt and blkid are required to validate branch UUIDs" >&2
    return 1
  }
  local device
  device="$(findmnt -n -o SOURCE -T "$root")"
  blkid -s UUID -o value "$device"
}

validate_branch_marker() {
  local tier="$1" root="$2" expected_id="$3" expected_uuid marker
  expected_uuid="$(branch_uuid "$tier" "$root")"
  marker="${root}/${branch_marker_name}"
  [[ -f "$marker" && ! -L "$marker" ]] || {
    echo "${tier} branch marker is missing or unsafe: ${marker}" >&2
    return 1
  }
  jq -e \
    --arg role "$tier" \
    --arg uuid "$expected_uuid" \
    --arg id "$expected_id" \
    '.schemaVersion == 1 and .role == $role and
     ((.filesystemUuid | ascii_downcase) == ($uuid | ascii_downcase)) and
     .branchId == $id and (.createdAt | type == "string")' \
    "$marker" >/dev/null || {
      echo "${tier} branch marker/UUID validation failed" >&2
      return 1
    }
}

ssd_branch_id="${POSIX_REVERSE_SSD_BRANCH_ID:-${DENIZ_POSIX_SSD_BRANCH_ID:-}}"
hdd_branch_id="${POSIX_REVERSE_HDD_BRANCH_ID:-${DENIZ_POSIX_HDD_BRANCH_ID:-}}"
for branch_id in "$ssd_branch_id" "$hdd_branch_id"; do
  [[ "$branch_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || {
    echo "Expected branch IDs must be canonical lowercase UUIDs" >&2
    exit 1
  }
done
[[ "$ssd_branch_id" != "$hdd_branch_id" ]] || {
  echo "Expected branch IDs must be distinct" >&2
  exit 1
}

validate_branch_marker ssd "$source_ssd" "$ssd_branch_id"
validate_branch_marker hdd "$source_hdd" "$hdd_branch_id"

xattr_value() {
  getfattr --only-values -n "$1" -- "$2" 2>/dev/null || true
}


# The canonical protected-metadata string. posix-manifest-verify.ts rebuilds
# exactly this from the forward manifest, so the two migration directions are
# compared by one hash rather than field by field.
protected_canonical() {
  local canonical="" key value
  for key in \
    ${xattr_ns}denizcloud.checksum \
    ${xattr_ns}denizcloud.checksum_state \
    ${xattr_ns}denizcloud.created_at \
    ${xattr_ns}denizcloud.id \
    ${xattr_ns}denizcloud.mime_type \
    ${xattr_ns}denizcloud.owner_id \
    ${xattr_ns}denizcloud.schema_version \
    ${xattr_ns}denizcloud.scope; do
    value="$(xattr_value "$key" "$1")"
    [[ -n "$value" ]] || continue
    canonical+="${key}=${value}"$'\n'
  done
  printf '%s' "$canonical"
}

observations_file="$(mktemp)"
entries_file="$(mktemp)"
skipped_sidecars=0
trap 'rm -f -- "$observations_file" "$entries_file"' EXIT

# Pass one records what each branch actually holds. It reads metadata but
# decides nothing: mergerfs clones a parent directory onto whichever branch it
# places a child on, and that clone carries no protected xattrs, so a directory
# without an ID is scaffolding rather than a missing identity.
scan_branch() {
  local branch="$1" tier="$2" absolute relative base kind size blocks
  while IFS= read -r -d '' absolute; do
    relative="${absolute#"$branch"/}"
    base="${relative##*/}"
    if [[ "$base" == "$branch_marker_name" || "$base" == "$witness_name" ]]; then
      continue
    fi
    if [[ "$base" == ._* ]]; then
      skipped_sidecars=$((skipped_sidecars + 1))
      continue
    fi
    if [[ "$base" == .*.migration.partial || "$base" == .*.reverse.partial ]]; then
      echo "Interrupted staging file is present: ${absolute}" >&2
      return 1
    fi
    if [[ -L "$absolute" ]]; then
      echo "Namespace contains a symlink: ${absolute}" >&2
      return 1
    fi
    if [[ -d "$absolute" ]]; then
      kind="folder"
      size=0
      blocks=0
    elif [[ -f "$absolute" ]]; then
      kind="file"
      size="$(stat -c '%s' "$absolute")"
      blocks="$(stat -c '%b' "$absolute")"
    else
      echo "Namespace contains an unsupported object: ${absolute}" >&2
      return 1
    fi
    jq -cn \
      --arg kind "$kind" \
      --arg tier "$tier" \
      --arg relative "$relative" \
      --arg absolute "$absolute" \
      --arg id "$(xattr_value ${xattr_ns}denizcloud.id "$absolute")" \
      --arg ownerId "$(xattr_value ${xattr_ns}denizcloud.owner_id "$absolute")" \
      --arg scope "$(xattr_value ${xattr_ns}denizcloud.scope "$absolute")" \
      --arg createdAt "$(xattr_value ${xattr_ns}denizcloud.created_at "$absolute")" \
      --arg schemaVersion "$(xattr_value ${xattr_ns}denizcloud.schema_version "$absolute")" \
      --arg checksum "$(xattr_value ${xattr_ns}denizcloud.checksum "$absolute")" \
      --arg checksumState "$(xattr_value ${xattr_ns}denizcloud.checksum_state "$absolute")" \
      --arg mimeType "$(xattr_value ${xattr_ns}denizcloud.mime_type "$absolute")" \
      --arg protectedXattrHash "$(protected_canonical "$absolute" | sha256sum | cut -d' ' -f1)" \
      --argjson sizeBytes "$size" \
      --argjson allocatedBlocks512 "$blocks" \
      'def blank: if . == "" then null else . end;
       {
         kind:$kind,
         tier:$tier,
         relative:$relative,
         absolute:$absolute,
         id:($id | blank),
         ownerId:($ownerId | blank),
         scope:($scope | blank),
         createdAt:($createdAt | blank),
         schemaVersion:($schemaVersion | blank),
         checksum:($checksum | blank),
         checksumState:($checksumState | blank),
         mimeType:($mimeType | blank),
         protectedXattrHash:$protectedXattrHash,
         sizeBytes:$sizeBytes,
         allocatedBlocks512:$allocatedBlocks512
       }' >> "$observations_file"
  done < <(find "$branch" -mindepth 1 -xdev -print0)
}

scan_branch "$source_ssd" ssd
scan_branch "$source_hdd" hdd

# Pass two resolves each relative path to its one authoritative entry and
# enforces every namespace invariant in a single program, so a violation stops
# the export rather than producing a plausible-looking manifest.
jq -s -c '
  def uuid: type == "string" and test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
  [group_by(.relative)[] |
    (.[0].relative) as $rel |
    (if (map(.kind) | unique | length) != 1
      then error("Relative path is a folder on one branch and a file on the other: " + $rel) else . end) |
    (if .[0].kind == "file" and length > 1
      then error("File resolves on both branches: " + $rel) else . end) |
    [.[] | select(.id != null)] as $identified |
    if ($identified | length) == 0 then error("No branch carries identity for " + $rel)
    elif ($identified | length) > 1 then error("Entry carries identity on both branches: " + $rel)
    else $identified[0] end
  ] as $entries |
  ($entries | group_by(.id) | map(select(length > 1)) | first) as $duplicate |
  (if $duplicate then
    error("Duplicate stable ID " + $duplicate[0].id + " on " + ($duplicate | map(.relative) | join(" and ")))
   else . end) |
  $entries |
  map(
    (.relative) as $rel |
    (if (.id | uuid) then . else error("Entry has a malformed identity: " + $rel) end) |
    (if .createdAt != null and .schemaVersion == "1" then .
     else error("Entry has incomplete protected metadata: " + $rel) end) |
    (if .ownerId != null then
       (if (.ownerId | uuid) then . else error("Entry has a malformed owner: " + $rel) end)
     elif .kind == "folder" and $rel == "shared" and .scope == "shared" then .
     else error("Only the shared root may omit an owner: " + $rel) end) |
    (if .kind == "file" then
       (if (.checksum | type == "string") and (.checksum | test("^[0-9a-f]{64}$")) then .
        else error("File has no checksum xattr: " + $rel) end) |
       (if .checksumState == "verified" then .
        else error("File checksum is " + (.checksumState // "absent") + ", not verified: " + $rel) end)
     else . end) |
    {
      schemaVersion:1,
      event:("reverse-" + .kind),
      id,
      path:("/" + .relative),
      name:(.relative | split("/") | last),
      sourcePath:.absolute,
      sourceTier:.tier,
      createdAt,
      ownerId,
      protectedXattrHash
    } +
    (if .kind == "file" then
      {checksum, mimeType, sizeBytes, allocatedBlocks512} else {} end)
  )[]
' "$observations_file" > "$entries_file"

# Legacy destinations: folders and SSD files keep the logical tree; HDD files
# return to their flat UUID address, which is what makes the old DB mapping the
# only way to read them again.
legacy_destination() {
  local kind="$1" tier="$2" relative="$3" id="$4"
  if [[ "$kind" == "file" && "$tier" == "hdd" ]]; then
    printf '%s/%s' "$target_hdd" "$id"
  else
    printf '%s/%s' "$target_ssd" "$relative"
  fi
}

folder_count="$(jq -s '[.[] | select(.event == "reverse-folder")] | length' "$entries_file")"
file_count="$(jq -s '[.[] | select(.event == "reverse-file")] | length' "$entries_file")"
entry_count=$((folder_count + file_count))

write_manifest() {
  local state="$1" verified="$2" temp
  [[ -n "$manifest_path" ]] || return 0
  temp="${manifest_path}.partial"
  jq -cn \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg snapshotId "$snapshot_id" \
    --arg mode "$mode" \
    --arg state "$state" \
    --arg ssdBranchId "$ssd_branch_id" \
    --arg hddBranchId "$hdd_branch_id" \
    --argjson folders "$folder_count" \
    --argjson files "$file_count" \
    --argjson verifiedEntries "$verified" \
    --argjson skippedSidecars "$skipped_sidecars" \
    '{
      schemaVersion:1,
      event:"reverse-summary",
      manifestSchema:"deniz-cloud-posix-reverse-v1",
      generatedAt:$generatedAt,
      snapshotId:$snapshotId,
      mode:$mode,
      state:$state,
      ssdBranchId:$ssdBranchId,
      hddBranchId:$hddBranchId,
      namespace:{folders:$folders,files:$files},
      verifiedEntries:$verifiedEntries,
      skippedAppleDoubleSidecars:$skippedSidecars,
      namespaceMutated:false
    }' > "$temp"
  # Parents before children, then files, so a consumer can replay the manifest
  # into the legacy layout in order.
  jq -s -c '
    ([.[] | select(.event == "reverse-folder")] | sort_by([(.path | split("/") | length), .path])[]),
    ([.[] | select(.event == "reverse-file")] | sort_by(.path)[])
  ' "$entries_file" >> "$temp"
  mv "$temp" "$manifest_path"
}

emit_summary() {
  local state="$1" verified="$2"
  jq -n \
    --arg mode "$mode" \
    --arg state "$state" \
    --arg snapshotId "$snapshot_id" \
    --arg journal "$journal_path" \
    --arg manifest "$manifest_path" \
    --argjson folders "$folder_count" \
    --argjson files "$file_count" \
    --argjson entries "$entry_count" \
    --argjson verifiedEntries "$verified" \
    --argjson skippedSidecars "$skipped_sidecars" \
    '{
      schemaVersion:1,
      mode:$mode,
      state:$state,
      snapshotId:$snapshotId,
      journal:$journal,
      manifest:(if $manifest == "" then null else $manifest end),
      namespaceEntries:$entries,
      namespaceFolders:$folders,
      namespaceFiles:$files,
      verifiedEntries:$verifiedEntries,
      skippedAppleDoubleSidecars:$skippedSidecars,
      namespaceMutated:false,
      sourceDeletionAllowed:false,
      copyContract:["preserve-bytes","preserve-xattrs","preserve-acls","preserve-sparse","copy-fsync-verify-publish","no-overwrite","journal-resume"]
    }'
}

if [[ "$mode" == "--dry-run" ]]; then
  write_manifest planned 0
  emit_summary planned 0
  exit 0
fi

for command in cp find flock install mv sync; do
  command -v "$command" >/dev/null || {
    echo "Required execute command is missing: ${command}" >&2
    exit 1
  }
done

for target in "$target_ssd" "$target_hdd"; do
  [[ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]] || {
    echo "Reverse export target is not empty: ${target}" >&2
    exit 1
  }
done

exec 9>"${journal_path}.lock"
flock -n 9 || {
  echo "Another reverse migration process owns the journal lock" >&2
  exit 1
}

namespace_hash="$(jq -s -S -c '.' "$entries_file" | sha256sum | cut -d' ' -f1)"
journal_append() {
  local event="$1" kind="${2:-}" id="${3:-}" destination="${4:-}"
  jq -cn \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg event "$event" \
    --arg kind "$kind" \
    --arg id "$id" \
    --arg destination "$destination" \
    '{schemaVersion:1,at:$at,event:$event} +
      (if $kind == "" then {} else {kind:$kind,id:$id,destination:$destination} end)' \
    >> "$journal_path"
  sync -f "$journal_path"
}

if [[ -e "$journal_path" ]]; then
  [[ -f "$journal_path" && ! -L "$journal_path" && "$(stat -c '%u:%a' "$journal_path")" == "0:600" ]] || {
    echo "Existing reverse journal must be root-owned mode 0600" >&2
    exit 1
  }
  jq -se \
    --arg hash "$namespace_hash" \
    --arg snapshot "$snapshot_id" '
      .[0].event == "reverse-start" and .[0].namespaceSha256 == $hash and
      .[0].snapshotId == $snapshot' "$journal_path" >/dev/null || {
    echo "Reverse journal does not match this namespace snapshot" >&2
    exit 1
  }
else
  install -m 0600 -o root -g root /dev/null "$journal_path"
  jq -cn \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg hash "$namespace_hash" \
    --arg snapshot "$snapshot_id" \
    '{schemaVersion:1,at:$at,event:"reverse-start",namespaceSha256:$hash,snapshotId:$snapshot,namespaceMutated:false}' \
    > "$journal_path"
  sync -f "$journal_path"
fi

verified_count=0
while IFS= read -r encoded; do
  entry="$(printf '%s' "$encoded" | base64 --decode)"
  kind="$(jq -er '.event | ltrimstr("reverse-")' <<< "$entry")"
  id="$(jq -er '.id' <<< "$entry")"
  relative="$(jq -er '.path | ltrimstr("/")' <<< "$entry")"
  source="$(jq -er '.sourcePath' <<< "$entry")"
  tier="$(jq -er '.sourceTier' <<< "$entry")"
  destination="$(legacy_destination "$kind" "$tier" "$relative" "$id")"
  checksum=""
  [[ "$kind" == "file" ]] && checksum="$(jq -er '.checksum' <<< "$entry")"

  if [[ -e "$destination" || -L "$destination" ]]; then
    echo "Refusing to overwrite an existing legacy destination: ${destination}" >&2
    exit 1
  fi
  parent="$(dirname "$destination")"
  [[ -d "$parent" && ! -L "$parent" ]] || {
    echo "Legacy destination parent is missing or unsafe: ${destination}" >&2
    exit 1
  }

  stage="${parent}/.${id}.reverse.partial"
  [[ ! -e "$stage" && ! -L "$stage" ]] || {
    echo "Reverse staging path already exists: ${stage}" >&2
    exit 1
  }
  journal_append entry-copying "$kind" "$id" "$destination"
  if [[ "$kind" == "folder" ]]; then
    cp --archive --attributes-only -- "$source" "$stage"
  else
    cp --preserve=all --sparse=always --reflink=auto -- "$source" "$stage"
  fi
  sync -f "$stage"
  if [[ "$kind" == "file" ]]; then
    [[ "$(stat -c '%s' "$stage")" == "$(jq -er '.sizeBytes' <<< "$entry")" ]]
    [[ "$(sha256sum "$stage" | cut -d' ' -f1)" == "$checksum" ]]
  fi
  mv -T -n -- "$stage" "$destination"
  [[ ! -e "$stage" && -e "$destination" && ! -L "$destination" ]] || {
    echo "Atomic no-overwrite publication failed: ${destination}" >&2
    exit 1
  }
  sync -f "$parent"
  journal_append entry-published "$kind" "$id" "$destination"
  if [[ "$kind" == "file" ]]; then
    [[ "$(sha256sum "$destination" | cut -d' ' -f1)" == "$checksum" ]]
  fi
  journal_append entry-verified "$kind" "$id" "$destination"
  verified_count=$((verified_count + 1))
done < <(jq -s -c -r '
  ([.[] | select(.event == "reverse-folder")] | sort_by([(.path | split("/") | length), .path])[]),
  ([.[] | select(.event == "reverse-file")] | sort_by(.path)[])
  | @base64' "$entries_file")

[[ "$verified_count" == "$entry_count" ]] || {
  echo "Final verified entry count does not match the namespace walk" >&2
  exit 1
}
journal_append reverse-verified
write_manifest verified "$verified_count"
emit_summary verified "$verified_count"
