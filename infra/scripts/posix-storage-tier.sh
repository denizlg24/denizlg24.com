#!/bin/bash

set -euo pipefail

umask 077

readonly production_ssd_branch="/mnt/ssd/deniz-cloud/namespace"
readonly production_hdd_branch="/mnt/hdd/deniz-cloud/namespace"
readonly branch_marker_name=".denizcloud-branch.json"
# Must equal PROTECTED_XATTR_NAMESPACE in
# packages/cloud-core/src/storage/metadata.ts; posix-xattr-namespace.test.ts
# fails if they drift.
readonly xattr_ns="security."

mode="--dry-run"
mode_set=false
plan_path=""

usage() {
  cat >&2 <<'USAGE'
Usage: posix-storage-tier.sh [--dry-run|--execute] --plan PATH

Executes same-relative-path tier moves. The plan is JSONL, one move per line:
  {"id":UUID,"relativePath":"...","from":"ssd","to":"hdd","checksum":HEX,"sizeBytes":N}

Dry-run validates the plan and every source without touching either branch.
Execute requires root and the exact production branch allowlist.

A move is copy -> fsync -> verify -> publish -> fsync parent -> unlink source.
The published path is identical on both branches, so a client's path never
changes and a crash leaves either the old or the new bytes, never a partial.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --dry-run | --execute)
      [[ "$mode_set" == false ]] || { usage; exit 2; }
      mode="$1"; mode_set=true; shift ;;
    --plan)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      plan_path="$2"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n "$plan_path" ]] || { usage; exit 2; }

for command in getfattr jq realpath sha256sum; do
  command -v "$command" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 1
  }
done

ssd_branch="${POSIX_TIER_SSD_BRANCH:-$production_ssd_branch}"
hdd_branch="${POSIX_TIER_HDD_BRANCH:-$production_hdd_branch}"

for path in "$ssd_branch" "$hdd_branch" "$plan_path"; do
  [[ "$path" == /* && "$path" != *$'\n'* ]] || {
    echo "Tiering paths must be absolute and single-line" >&2
    exit 1
  }
done

if [[ "$mode" != "--dry-run" ]]; then
  for command in cp mkdir mv rm setfattr sync; do
    command -v "$command" >/dev/null || {
      echo "Required execute command is missing: ${command}" >&2
      exit 1
    }
  done
  ((EUID == 0)) || { echo "${mode} requires root" >&2; exit 1; }
  if [[ "$ssd_branch" != "$production_ssd_branch" \
    || "$hdd_branch" != "$production_hdd_branch" ]]; then
    echo "${mode} requires the exact production branch allowlist" >&2
    exit 1
  fi
fi

[[ -f "$plan_path" && ! -L "$plan_path" ]] || {
  echo "Plan is missing or unsafe: ${plan_path}" >&2
  exit 1
}
for branch in "$ssd_branch" "$hdd_branch"; do
  [[ -d "$branch" && ! -L "$branch" ]] || {
    echo "Branch is missing or unsafe: ${branch}" >&2
    exit 1
  }
  # An unmounted branch is an empty directory; moving into one would report
  # success while writing to the root filesystem.
  [[ -f "${branch}/${branch_marker_name}" && ! -L "${branch}/${branch_marker_name}" ]] || {
    echo "Branch marker is missing: ${branch}" >&2
    exit 1
  }
done
ssd_branch="$(realpath "$ssd_branch")"
hdd_branch="$(realpath "$hdd_branch")"

branch_root() {
  case "$1" in
    ssd) printf '%s' "$ssd_branch" ;;
    hdd) printf '%s' "$hdd_branch" ;;
    *) return 1 ;;
  esac
}

validate_plan() {
  jq -se '
    def uuid: type == "string" and test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    def safe_rel: type == "string" and length > 0 and (startswith("/") | not) and
      (endswith("/") | not) and (contains("//") | not) and
      (split("/") | all(. != "." and . != ".." and (startswith("._") | not)));
    all(.[];
      (.id | uuid) and (.relativePath | safe_rel) and
      (.checksum | type == "string" and test("^[0-9a-f]{64}$")) and
      (.sizeBytes | type == "number" and floor == . and . >= 0) and
      ((.from == "ssd" and .to == "hdd") or (.from == "hdd" and .to == "ssd")))
  ' "$plan_path" >/dev/null
}

validate_plan || {
  echo "Plan contains an entry that is not a safe same-path tier move" >&2
  exit 1
}

planned="$(jq -s 'length' "$plan_path")"

xattr_value() { getfattr --only-values -n "$1" -- "$2" 2>/dev/null || true; }

copy_protected_metadata() {
  local source="$1" destination="$2" key value
  for key in checksum checksum_state created_at id mime_type owner_id schema_version scope; do
    value="$(xattr_value "${xattr_ns}denizcloud.${key}" "$source")"
    [[ -n "$value" ]] || continue
    setfattr -n "${xattr_ns}denizcloud.${key}" -v "$value" -- "$destination"
  done
}

eligible=0
moved=0
skipped=0
quarantined=0

while IFS= read -r encoded; do
  entry="$(printf '%s' "$encoded" | base64 --decode)"
  id="$(jq -er '.id' <<< "$entry")"
  relative="$(jq -er '.relativePath' <<< "$entry")"
  from="$(jq -er '.from' <<< "$entry")"
  to="$(jq -er '.to' <<< "$entry")"
  checksum="$(jq -er '.checksum' <<< "$entry")"
  source="$(branch_root "$from")/${relative}"
  destination="$(branch_root "$to")/${relative}"

  if [[ ! -f "$source" || -L "$source" ]]; then
    echo "Source is missing or unsafe, skipping: ${relative}" >&2
    skipped=$((skipped + 1))
    continue
  fi
  if [[ "$(xattr_value "${xattr_ns}denizcloud.id" "$source")" != "$id" ]]; then
    echo "Source identity does not match the plan: ${relative}" >&2
    quarantined=$((quarantined + 1))
    continue
  fi
  if [[ "$(sha256sum "$source" | cut -d' ' -f1)" != "$checksum" ]]; then
    echo "Source checksum does not match the plan: ${relative}" >&2
    quarantined=$((quarantined + 1))
    continue
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    # Both branches already hold the path. That is the crash state, and
    # resolving it needs the projection's tier hint, so it is not this
    # script's call to make.
    echo "Destination already exists, leaving for duplicate resolution: ${relative}" >&2
    quarantined=$((quarantined + 1))
    continue
  fi

  eligible=$((eligible + 1))
  if [[ "$mode" == "--dry-run" ]]; then
    continue
  fi

  parent="$(dirname "$destination")"
  mkdir -p "$parent"
  stage="${parent}/.${id}.tier.partial"
  [[ ! -e "$stage" && ! -L "$stage" ]] || {
    echo "Tier staging path already exists: ${stage}" >&2
    quarantined=$((quarantined + 1))
    continue
  }

  cp --preserve=all --sparse=always --reflink=auto -- "$source" "$stage"
  copy_protected_metadata "$source" "$stage"
  sync -f "$stage"
  if [[ "$(sha256sum "$stage" | cut -d' ' -f1)" != "$checksum" ]] \
    || [[ "$(xattr_value "${xattr_ns}denizcloud.id" "$stage")" != "$id" ]]; then
    rm -f -- "$stage"
    echo "Destination verification failed, source untouched: ${relative}" >&2
    quarantined=$((quarantined + 1))
    continue
  fi

  # Publish, then fsync the parent so the rename is durable before the source
  # is removed. A crash after this point leaves both copies, which duplicate
  # resolution settles from the projection's tier hint.
  mv -T -n -- "$stage" "$destination"
  sync -f "$parent"
  [[ -f "$destination" && ! -L "$destination" ]] || {
    echo "Publication failed, source untouched: ${relative}" >&2
    quarantined=$((quarantined + 1))
    continue
  }
  rm -f -- "$source"
  sync -f "$(dirname "$source")"
  moved=$((moved + 1))
done < <(jq -rc '@base64' "$plan_path")

jq -n \
  --arg mode "$mode" \
  --argjson planned "$planned" \
  --argjson eligible "$eligible" \
  --argjson moved "$moved" \
  --argjson skipped "$skipped" \
  --argjson quarantined "$quarantined" \
  '{schemaVersion:1,mode:$mode,planned:$planned,eligible:$eligible,moved:$moved,skipped:$skipped,quarantined:$quarantined,sourceDeletedOnlyAfterVerifiedPublish:true}'
