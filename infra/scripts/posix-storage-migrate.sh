#!/bin/bash

set -euo pipefail

umask 077

readonly production_source_ssd="/mnt/ssd/storage"
readonly production_source_hdd="/mnt/hdd/storage"
readonly production_target_ssd="/mnt/ssd/deniz-cloud/namespace"
readonly production_target_hdd="/mnt/hdd/deniz-cloud/namespace"
readonly production_snapshot_root="/mnt/hdd/backups"
readonly production_journal_root="/var/lib/deniz-cloud/posix-migration"
readonly branch_marker_name=".denizcloud-branch.json"
# Must equal PROTECTED_XATTR_NAMESPACE in
# packages/cloud-core/src/storage/metadata.ts; posix-xattr-namespace.test.ts
# fails if they drift.
readonly xattr_ns="user."

mode="--dry-run"
mode_set=false
inventory_path=""
snapshot_id=""
allow_live_api_no_writes=false

usage() {
  cat >&2 <<'USAGE'
Usage: posix-storage-migrate.sh [--dry-run|--execute|--rollback]
       --inventory PATH --snapshot-id SNAPSHOT_ID
       [--allow-live-api-no-writes]

Dry-run is the default and never creates a journal or changes either branch.
Execute requires an inventory exported with posix-inventory --migration-manifest
and STOPs when that per-entry manifest does not validate. Rollback always STOPs:
reverse migration is a separate operator action.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --dry-run | --execute | --rollback)
      if [[ "$mode_set" == "true" ]]; then
        usage
        exit 2
      fi
      mode="$1"
      mode_set=true
      shift
      ;;
    --inventory)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      inventory_path="$2"
      shift 2
      ;;
    --snapshot-id)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      snapshot_id="$2"
      shift 2
      ;;
    --allow-live-api-no-writes)
      allow_live_api_no_writes=true
      shift
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

[[ -n "$inventory_path" && -n "$snapshot_id" ]] || { usage; exit 2; }
if [[ ! "$snapshot_id" =~ ^posix-gate0-[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "Snapshot ID must be an exact Gate 0 snapshot ID" >&2
  exit 1
fi
current_snapshot_id="${POSIX_MIGRATION_CURRENT_SNAPSHOT_ID:-}"
if [[ "$current_snapshot_id" != "$snapshot_id" ]]; then
  echo "Snapshot ID must match POSIX_MIGRATION_CURRENT_SNAPSHOT_ID" >&2
  exit 1
fi

for command in jq realpath sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done

source_ssd="${POSIX_MIGRATION_SOURCE_SSD:-$production_source_ssd}"
source_hdd="${POSIX_MIGRATION_SOURCE_HDD:-$production_source_hdd}"
target_ssd="${POSIX_MIGRATION_TARGET_SSD:-$production_target_ssd}"
target_hdd="${POSIX_MIGRATION_TARGET_HDD:-$production_target_hdd}"
snapshot_root="${POSIX_MIGRATION_SNAPSHOT_ROOT:-$production_snapshot_root}"
journal_path="${POSIX_MIGRATION_JOURNAL:-${production_journal_root}/${snapshot_id}.journal.jsonl}"
api_container="${API_CONTAINER:-deniz-cloud-api-1}"

for path in \
  "$inventory_path" \
  "$source_ssd" \
  "$source_hdd" \
  "$target_ssd" \
  "$target_hdd" \
  "$snapshot_root" \
  "$journal_path"; do
  [[ "$path" == /* && "$path" != *$'\n'* ]] || {
    echo "Migration paths must be absolute and single-line" >&2
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
    || "$snapshot_root" != "$production_snapshot_root" \
    || "$journal_path" != "${production_journal_root}/${snapshot_id}.journal.jsonl" ]]; then
    echo "${mode} requires the exact production storage path allowlist" >&2
    exit 1
  fi
fi

for path in "$inventory_path" "$source_ssd" "$source_hdd" "$target_ssd" "$target_hdd" "$snapshot_root"; do
  [[ -e "$path" ]] || {
    echo "Required migration input is missing: ${path}" >&2
    exit 1
  }
done

source_ssd="$(realpath "$source_ssd")"
source_hdd="$(realpath "$source_hdd")"
target_ssd="$(realpath "$target_ssd")"
target_hdd="$(realpath "$target_hdd")"
snapshot_root="$(realpath "$snapshot_root")"
inventory_path="$(realpath "$inventory_path")"
journal_parent="$(dirname "$journal_path")"
[[ -d "$journal_parent" ]] || {
  echo "Migration journal parent must already exist" >&2
  exit 1
}
journal_path="$(realpath "$journal_parent")/$(basename "$journal_path")"
if [[ -L "$journal_path" || ( -e "$journal_path" && ! -f "$journal_path" ) ]]; then
  echo "Existing migration journal is unsafe" >&2
  exit 1
fi

if [[ "$mode" != "--dry-run" \
  && ( "$source_ssd" != "$production_source_ssd" \
    || "$source_hdd" != "$production_source_hdd" \
    || "$target_ssd" != "$production_target_ssd" \
    || "$target_hdd" != "$production_target_hdd" \
    || "$snapshot_root" != "$production_snapshot_root" \
    || "$journal_path" != "${production_journal_root}/${snapshot_id}.journal.jsonl" ) ]]; then
  echo "${mode} production paths must not resolve through symlinks" >&2
  exit 1
fi

roots=("$source_ssd" "$source_hdd" "$target_ssd" "$target_hdd")
for ((left = 0; left < ${#roots[@]}; left++)); do
  [[ "${roots[$left]}" != "/" ]] || {
    echo "Storage roots must be below /" >&2
    exit 1
  }
  for ((right = left + 1; right < ${#roots[@]}; right++)); do
    if [[ "${roots[$left]}" == "${roots[$right]}" \
      || "${roots[$left]}" == "${roots[$right]}/"* \
      || "${roots[$right]}" == "${roots[$left]}/"* ]]; then
      echo "Source and target roots must be distinct and non-overlapping" >&2
      exit 1
    fi
  done
done

path_is_at_or_inside() {
  local root="$1"
  local candidate="$2"
  [[ "$candidate" == "$root" || "$candidate" == "$root/"* ]]
}

for root in "${roots[@]}"; do
  if path_is_at_or_inside "$root" "$journal_path"; then
    echo "Migration journal must stay outside source and target roots" >&2
    exit 1
  fi
done

# Legacy internals remain independent and are never migration destinations.
protected_legacy_paths=(
  "${source_ssd}/.s3-v2"
  "${source_ssd}/.s3-v2-temp"
  "${source_ssd}/.tus-partial"
  "${source_ssd}/.archives"
)
for protected in "${protected_legacy_paths[@]}"; do
  if path_is_at_or_inside "$target_ssd" "$protected" \
    || path_is_at_or_inside "$target_hdd" "$protected"; then
    echo "S3, TUS and archive internals must remain outside namespace branches" >&2
    exit 1
  fi
done

snapshot_dir="${snapshot_root}/${snapshot_id}"
snapshot_manifest="${snapshot_dir}/manifest.json"
snapshot_checksums="${snapshot_dir}/SHA256SUMS"
[[ -f "$snapshot_manifest" ]] || {
  echo "Gate 0 snapshot manifest is missing: ${snapshot_manifest}" >&2
  exit 1
}
[[ -f "$snapshot_checksums" && ! -L "$snapshot_checksums" ]] || {
  echo "Gate 0 snapshot checksum manifest is missing or unsafe" >&2
  exit 1
}
(
  cd "$snapshot_dir"
  sha256sum -c SHA256SUMS >/dev/null
) || {
  echo "Gate 0 snapshot checksums failed" >&2
  exit 1
}
if [[ "$(jq -er '.schemaVersion == 1 and .snapshotId == $id' --arg id "$snapshot_id" "$snapshot_manifest")" != "true" ]]; then
  echo "Gate 0 snapshot manifest does not match ${snapshot_id}" >&2
  exit 1
fi
if [[ -e "${snapshot_dir}/.incomplete" ]]; then
  echo "Gate 0 snapshot is incomplete" >&2
  exit 1
fi

branch_uuid() {
  local tier="$1"
  local root="$2"
  local configured=""
  if [[ "$tier" == "ssd" ]]; then
    configured="${POSIX_MIGRATION_SSD_UUID:-}"
  else
    configured="${POSIX_MIGRATION_HDD_UUID:-}"
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
  local source
  source="$(findmnt -n -o SOURCE -T "$root")"
  blkid -s UUID -o value "$source"
}

validate_branch_marker() {
  local tier="$1"
  local root="$2"
  local expected_id="$3"
  local expected_uuid marker
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
     .branchId == $id and
     (.createdAt | type == "string")' \
    "$marker" >/dev/null || {
      echo "${tier} branch marker/UUID validation failed" >&2
      return 1
    }
}

ssd_branch_id="${POSIX_MIGRATION_SSD_BRANCH_ID:-${DENIZ_POSIX_SSD_BRANCH_ID:-}}"
hdd_branch_id="${POSIX_MIGRATION_HDD_BRANCH_ID:-${DENIZ_POSIX_HDD_BRANCH_ID:-}}"
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

validate_branch_marker ssd "$target_ssd" "$ssd_branch_id"
validate_branch_marker hdd "$target_hdd" "$hdd_branch_id"

summary_count="$(jq -s '[.[] | select(.event == "inventory-summary")] | length' "$inventory_path")"
[[ "$summary_count" == "1" ]] || {
  echo "Inventory must contain exactly one inventory-summary record" >&2
  exit 1
}
inventory_green="$(jq -sr '[.[] | select(.event == "inventory-summary")][0].allGreen == true' "$inventory_path")"
[[ "$inventory_green" == "true" ]] || {
  echo "Inventory is not all-green" >&2
  exit 1
}

entry_count="$(jq -s '[.[] | select(.event == "migration-file" or .event == "migration-folder")] | length' "$inventory_path")"
if jq -se \
  --arg ssd "$source_ssd" \
  --arg hdd "$source_hdd" '
  def uuid: type == "string" and test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
  def timestamp: type == "string" and length > 0;
  def safe_path: type == "string" and startswith("/") and length > 1 and
    (endswith("/") | not) and (contains("//") | not) and
    (split("/") | all(. != "." and . != ".."));
  def common: .schemaVersion == 1 and (.id | uuid) and (.path | safe_path) and
    .targetRelativePath == (.path | ltrimstr("/")) and
    (.createdAt | timestamp) and (.updatedAt | timestamp) and
    (.name | type == "string" and length > 0);
  ([.[] | select(.event == "inventory-summary")][0]) as $summary |
  [.[] | select(.event == "migration-folder")] as $folders |
  [.[] | select(.event == "migration-file")] as $files |
  ($folders | map(.id)) as $folderIds |
  $summary.schemaVersion == 1 and
  $summary.manifestSchema == "deniz-cloud-posix-migration-v1" and
  $summary.allGreen == true and
  $summary.database.folders.count == ($folders | length) and
  $summary.database.files.count == ($files | length) and
  ($folders | all(common and .targetTier == "ssd" and
    (.ownerId == null or (.ownerId | uuid)) and
    (.parentId == null or (.parentId | uuid)) and
    (.sourcePath == ($ssd + .path)))) and
  ($files | all(common and (.ownerId | uuid) and (.folderId | uuid) and
    (.folderId as $folderId | ($folderIds | index($folderId)) != null) and
    (.mimeType == null or (.mimeType | type == "string")) and
    (.checksum | type == "string" and test("^[0-9a-f]{64}$")) and
    (.sizeBytes | type == "number" and floor == . and . >= 0) and
    (.allocatedBlocks512 | type == "number" and floor == . and . >= 0) and
    (.targetTier == "ssd" or .targetTier == "hdd") and
    .sourcePath == (if .targetTier == "ssd" then ($ssd + .path) else ($hdd + "/" + .id) end)))
  ' "$inventory_path" >/dev/null; then
  manifest_contract_complete=true
  stop_reason=""
else
  manifest_contract_complete=false
  stop_reason="inventory does not satisfy deniz-cloud-posix-migration-v1"
fi

api_running=false
if [[ -n "${POSIX_MIGRATION_API_RUNNING:-}" ]]; then
  if [[ "$mode" != "--dry-run" || ! "${POSIX_MIGRATION_API_RUNNING}" =~ ^(true|false)$ ]]; then
    echo "POSIX_MIGRATION_API_RUNNING is a dry-run-only true/false override" >&2
    exit 1
  fi
  api_running="${POSIX_MIGRATION_API_RUNNING}"
elif command -v docker >/dev/null; then
  api_running="$(docker inspect --format '{{.State.Running}}' "$api_container" 2>/dev/null || printf 'false')"
fi
if [[ "$api_running" == "true" && "$allow_live_api_no_writes" != "true" ]]; then
  echo "API is running; pass --allow-live-api-no-writes only with an operator-enforced storage write freeze" >&2
  exit 1
fi

emit_summary() {
  local state="$1"
  local verified="${2:-0}"
  jq -n \
    --arg mode "$mode" \
    --arg state "$state" \
    --arg inventory "$inventory_path" \
    --arg snapshotId "$snapshot_id" \
    --arg journal "$journal_path" \
    --arg stopReason "$stop_reason" \
    --argjson inventoryEntries "$entry_count" \
    --argjson verifiedEntries "$verified" \
    --argjson apiRunning "$api_running" \
    --argjson allowLiveApiNoWrites "$allow_live_api_no_writes" \
    --argjson manifestContractComplete "$manifest_contract_complete" '
      {
        schemaVersion:1,
        mode:$mode,
        state:$state,
        executable:$manifestContractComplete,
        inventory:$inventory,
        snapshotId:$snapshotId,
        journal:$journal,
        inventoryEntries:$inventoryEntries,
        verifiedEntries:$verifiedEntries,
        apiRunning:$apiRunning,
        allowLiveApiNoWrites:$allowLiveApiNoWrites,
        sourceDeletionAllowed:false,
        copyContract:["preserve-bytes","preserve-xattrs","preserve-acls","preserve-sparse","copy-fsync-verify-publish","no-overwrite","journal-resume"],
        blockers:(if $manifestContractComplete then [] else [{code:"INVENTORY_MANIFEST_CONTRACT_MISSING",message:$stopReason}] end),
        stopReason:(if $manifestContractComplete then null else $stopReason end)
      }'
}

if [[ "$mode" == "--dry-run" ]]; then
  emit_summary planned
  exit 0
fi

if [[ "$manifest_contract_complete" != "true" ]]; then
  emit_summary blocked
  echo "STOP: execute requires a complete inventory-exported per-entry manifest; no source or target was changed" >&2
  exit 20
fi

if [[ "$mode" == "--rollback" ]]; then
  emit_summary blocked
  echo "STOP: rollback is a separate operator action and is not implemented; no source or target was changed" >&2
  exit 20
fi

for command in base64 cp cut diff flock getfacl getfattr install mv setfattr stat sync; do
  command -v "$command" >/dev/null || {
    echo "Required execute command is missing: ${command}" >&2
    exit 1
  }
done

for target in "$target_ssd" "$target_hdd"; do
  if find "$target" -xdev \( -type l -o -type p -o -type s -o -type b -o -type c \) -print -quit | grep -q .; then
    echo "Target namespace contains a symlink or special object" >&2
    exit 1
  fi
  if find "$target" -xdev -type f -links +1 -print -quit | grep -q .; then
    echo "Target namespace contains a hard-linked file" >&2
    exit 1
  fi
done

manifest_hash="$(sha256sum "$inventory_path" | cut -d' ' -f1)"
exec 9>"${journal_path}.lock"
flock -n 9 || {
  echo "Another migration process owns the journal lock" >&2
  exit 1
}

journal_append() {
  local event="$1"
  local kind="${2:-}"
  local id="${3:-}"
  local destination="${4:-}"
  local checksum="${5:-}"
  jq -cn \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg event "$event" \
    --arg kind "$kind" \
    --arg id "$id" \
    --arg destination "$destination" \
    --arg checksum "$checksum" \
    '{schemaVersion:1,at:$at,event:$event} +
      (if $kind == "" then {} else {kind:$kind,id:$id,destination:$destination} end) +
      (if $checksum == "" then {} else {checksum:$checksum} end)' \
    >> "$journal_path"
  sync -f "$journal_path"
}

if [[ -e "$journal_path" ]]; then
  [[ -f "$journal_path" && ! -L "$journal_path" && "$(stat -c '%u:%a' "$journal_path")" == "0:600" ]] || {
    echo "Existing migration journal must be root-owned mode 0600" >&2
    exit 1
  }
  jq -se \
    --arg hash "$manifest_hash" \
    --arg snapshot "$snapshot_id" \
    --arg ssd "$ssd_branch_id" \
    --arg hdd "$hdd_branch_id" '
      .[0].event == "migration-start" and .[0].manifestSha256 == $hash and
      .[0].snapshotId == $snapshot and .[0].ssdBranchId == $ssd and
      .[0].hddBranchId == $hdd' "$journal_path" >/dev/null || {
    echo "Migration journal does not match this manifest/snapshot/branch set" >&2
    exit 1
  }
else
  install -m 0600 -o root -g root /dev/null "$journal_path"
  jq -cn \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg hash "$manifest_hash" \
    --arg snapshot "$snapshot_id" \
    --arg ssd "$ssd_branch_id" \
    --arg hdd "$hdd_branch_id" \
    '{schemaVersion:1,at:$at,event:"migration-start",manifestSha256:$hash,snapshotId:$snapshot,ssdBranchId:$ssd,hddBranchId:$hdd,sourceDeletionAllowed:false}' \
    > "$journal_path"
  sync -f "$journal_path"
fi

journal_verified() {
  local kind="$1" id="$2"
  jq -se --arg kind "$kind" --arg id "$id" \
    'any(.[]; .event == "entry-verified" and .kind == $kind and .id == $id)' \
    "$journal_path" >/dev/null
}

xattr_value() {
  getfattr --only-values -n "$1" -- "$2" 2>/dev/null
}

verify_preserved_metadata() {
  local source="$1" destination="$2"
  diff \
    <(getfacl -cp -- "$source") \
    <(getfacl -cp -- "$destination") >/dev/null
  diff \
    <(getfattr -d -m- -- "$source" 2>/dev/null | sed '/^#/d;/^user\.denizcloud\./d' | LC_ALL=C sort) \
    <(getfattr -d -m- -- "$destination" 2>/dev/null | sed '/^#/d;/^user\.denizcloud\./d' | LC_ALL=C sort) >/dev/null
}

set_protected_metadata() {
  local entry="$1" destination="$2" kind="$3"
  local id owner created mime checksum path
  id="$(jq -er '.id' <<< "$entry")"
  owner="$(jq -r '.ownerId // empty' <<< "$entry")"
  created="$(jq -er '.createdAt' <<< "$entry")"
  path="$(jq -er '.path' <<< "$entry")"
  setfattr -n ${xattr_ns}denizcloud.id -v "$id" -- "$destination"
  setfattr -n ${xattr_ns}denizcloud.created_at -v "$created" -- "$destination"
  setfattr -n ${xattr_ns}denizcloud.schema_version -v 1 -- "$destination"
  setfattr -x ${xattr_ns}denizcloud.owner_id -- "$destination" 2>/dev/null || true
  setfattr -x ${xattr_ns}denizcloud.scope -- "$destination" 2>/dev/null || true
  if [[ -n "$owner" ]]; then
    setfattr -n ${xattr_ns}denizcloud.owner_id -v "$owner" -- "$destination"
  elif [[ "$kind" == "folder" && "$path" == "/shared" ]]; then
    setfattr -n ${xattr_ns}denizcloud.scope -v shared -- "$destination"
  else
    echo "Only the shared root may omit ownerId" >&2
    return 1
  fi
  if [[ "$kind" == "file" ]]; then
    checksum="$(jq -er '.checksum' <<< "$entry")"
    mime="$(jq -r '.mimeType // empty' <<< "$entry")"
    setfattr -n ${xattr_ns}denizcloud.checksum -v "$checksum" -- "$destination"
    setfattr -n ${xattr_ns}denizcloud.checksum_state -v verified -- "$destination"
    setfattr -x ${xattr_ns}denizcloud.mime_type -- "$destination" 2>/dev/null || true
    if [[ -n "$mime" ]]; then
      setfattr -n ${xattr_ns}denizcloud.mime_type -v "$mime" -- "$destination"
    fi
  fi
}

verify_protected_metadata() {
  local entry="$1" destination="$2" kind="$3"
  local expected owner path mime
  for pair in \
    "${xattr_ns}denizcloud.id:id" \
    "${xattr_ns}denizcloud.created_at:createdAt"; do
    expected="$(jq -er ".${pair#*:}" <<< "$entry")"
    [[ "$(xattr_value "${pair%%:*}" "$destination")" == "$expected" ]]
  done
  [[ "$(xattr_value ${xattr_ns}denizcloud.schema_version "$destination")" == 1 ]]
  owner="$(jq -r '.ownerId // empty' <<< "$entry")"
  path="$(jq -er '.path' <<< "$entry")"
  if [[ -n "$owner" ]]; then
    [[ "$(xattr_value ${xattr_ns}denizcloud.owner_id "$destination")" == "$owner" ]]
  else
    [[ "$kind" == folder && "$path" == /shared ]]
    [[ "$(xattr_value ${xattr_ns}denizcloud.scope "$destination")" == shared ]]
  fi
  if [[ "$kind" == file ]]; then
    [[ "$(xattr_value ${xattr_ns}denizcloud.checksum "$destination")" == "$(jq -er '.checksum' <<< "$entry")" ]]
    [[ "$(xattr_value ${xattr_ns}denizcloud.checksum_state "$destination")" == verified ]]
    mime="$(jq -r '.mimeType // empty' <<< "$entry")"
    if [[ -n "$mime" ]]; then
      [[ "$(xattr_value ${xattr_ns}denizcloud.mime_type "$destination")" == "$mime" ]]
    fi
  fi
}

materialize_hdd_parents() {
  local relative_path="$1"
  local parent="${relative_path%/*}"
  local current="" component source destination
  [[ "$parent" != "$relative_path" ]] || return 0
  IFS='/' read -r -a components <<< "$parent"
  for component in "${components[@]}"; do
    current="${current:+$current/}${component}"
    source="${source_ssd}/${current}"
    destination="${target_hdd}/${current}"
    [[ -d "$source" && ! -L "$source" ]] || {
      echo "Missing safe SSD parent for HDD file: ${current}" >&2
      return 1
    }
    if [[ -e "$destination" || -L "$destination" ]]; then
      [[ -d "$destination" && ! -L "$destination" ]] || return 1
    else
      cp --archive --attributes-only -- "$source" "$destination"
      sync -f "$(dirname "$destination")"
    fi
  done
}

verified_count=0
while IFS= read -r encoded; do
  entry="$(printf '%s' "$encoded" | base64 --decode)"
  event="$(jq -er '.event' <<< "$entry")"
  kind="${event#migration-}"
  id="$(jq -er '.id' <<< "$entry")"
  relative_path="$(jq -er '.targetRelativePath' <<< "$entry")"
  source="$(jq -er '.sourcePath' <<< "$entry")"
  tier="$(jq -er '.targetTier' <<< "$entry")"
  target_root="$target_ssd"
  [[ "$tier" == hdd ]] && target_root="$target_hdd"
  destination="${target_root}/${relative_path}"
  checksum=""
  [[ "$kind" == file ]] && checksum="$(jq -er '.checksum' <<< "$entry")"

  if journal_verified "$kind" "$id"; then
    [[ -e "$destination" && ! -L "$destination" ]] || {
      echo "Journaled destination is missing or unsafe: ${destination}" >&2
      exit 1
    }
    verify_protected_metadata "$entry" "$destination" "$kind"
    if [[ "$kind" == file ]]; then
      [[ "$(sha256sum "$destination" | cut -d' ' -f1)" == "$checksum" ]]
    fi
    verified_count=$((verified_count + 1))
    continue
  fi

  if [[ -e "$destination" || -L "$destination" ]]; then
    echo "Refusing to overwrite unjournaled destination: ${destination}" >&2
    exit 1
  fi
  if [[ "$tier" == hdd ]]; then
    materialize_hdd_parents "$relative_path"
  else
    [[ -d "$(dirname "$destination")" && ! -L "$(dirname "$destination")" ]] || {
      echo "Destination parent is missing or unsafe: ${destination}" >&2
      exit 1
    }
  fi
  stage="$(dirname "$destination")/.${id}.migration.partial"
  [[ ! -e "$stage" && ! -L "$stage" ]] || {
    echo "Migration staging path already exists: ${stage}" >&2
    exit 1
  }
  journal_append entry-copying "$kind" "$id" "$destination" "$checksum"
  if [[ "$kind" == folder ]]; then
    cp --archive --attributes-only -- "$source" "$stage"
  else
    cp --preserve=all --sparse=always --reflink=auto -- "$source" "$stage"
  fi
  set_protected_metadata "$entry" "$stage" "$kind"
  sync -f "$stage"
  verify_preserved_metadata "$source" "$stage"
  verify_protected_metadata "$entry" "$stage" "$kind"
  if [[ "$kind" == file ]]; then
    [[ "$(stat -c '%s' "$stage")" == "$(jq -er '.sizeBytes' <<< "$entry")" ]]
    [[ "$(sha256sum "$stage" | cut -d' ' -f1)" == "$checksum" ]]
    source_blocks="$(jq -er '.allocatedBlocks512' <<< "$entry")"
    if (( source_blocks * 512 < $(jq -er '.sizeBytes' <<< "$entry") )); then
      (( $(stat -c '%b' "$stage") * 512 < $(jq -er '.sizeBytes' <<< "$entry") )) || {
        echo "Sparse allocation was not preserved: ${destination}" >&2
        exit 1
      }
    fi
  fi
  mv -T -n -- "$stage" "$destination"
  [[ ! -e "$stage" && -e "$destination" && ! -L "$destination" ]] || {
    echo "Atomic no-overwrite publication failed: ${destination}" >&2
    exit 1
  }
  sync -f "$(dirname "$destination")"
  journal_append entry-published "$kind" "$id" "$destination" "$checksum"
  verify_protected_metadata "$entry" "$destination" "$kind"
  if [[ "$kind" == file ]]; then
    [[ "$(sha256sum "$destination" | cut -d' ' -f1)" == "$checksum" ]]
  fi
  journal_append entry-verified "$kind" "$id" "$destination" "$checksum"
  verified_count=$((verified_count + 1))
done < <(jq -rc 'select(.event == "migration-folder" or .event == "migration-file") | @base64' "$inventory_path")

[[ "$verified_count" == "$entry_count" ]] || {
  echo "Final verified entry count does not match manifest" >&2
  exit 1
}
journal_append migration-verified
emit_summary verified "$verified_count"
