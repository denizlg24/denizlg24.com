#!/bin/bash

set -euo pipefail
set +x

umask 077

mode="--dry-run"
mode_set=false
action=""
root=""
run_id=""
evidence=""

usage() {
  cat >&2 <<'EOF'
Usage: posix-gate1-metadata.sh [--dry-run|--execute] --action seed|smb-adversarial|verify|cleanup --root PATH --run-id UUID [--evidence PATH]

smb-adversarial reads POSIX_GATE1_SMB_HOST, POSIX_GATE1_SMB_SHARE and
POSIX_GATE1_SMB_AUTH_FILE from the environment. Credentials are never accepted
as arguments or written to output/evidence.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --dry-run|--execute)
      [[ "$mode_set" == "false" ]] || { usage; exit 2; }
      mode="$1"
      mode_set=true
      shift
      ;;
    --action)
      [[ $# -ge 2 && -z "$action" ]] || { usage; exit 2; }
      action="$2"
      shift 2
      ;;
    --root)
      [[ $# -ge 2 && -z "$root" ]] || { usage; exit 2; }
      root="$2"
      shift 2
      ;;
    --run-id)
      [[ $# -ge 2 && -z "$run_id" ]] || { usage; exit 2; }
      run_id="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
      shift 2
      ;;
    --evidence)
      [[ $# -ge 2 && -z "$evidence" ]] || { usage; exit 2; }
      evidence="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ ! "$action" =~ ^(seed|smb-adversarial|verify|cleanup)$ \
  || ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ \
  || -z "$root" ]]; then
  usage
  exit 2
fi

if [[ "$root" != "/" ]]; then root="${root%/}"; fi
if [[ "$root" != /* || "$root" == *//* || "$root" == */./* || "$root" == */../* \
  || "$root" == */. || "$root" == */.. ]]; then
  echo "Metadata root must be a normalized absolute path" >&2
  exit 1
fi
if [[ "$(basename "$root")" != "posix-gate1-metadata-${run_id}" ]]; then
  echo "Metadata root name must match its run ID" >&2
  exit 1
fi
for protected_root in \
  /data/ssd \
  /data/hdd \
  /mnt/ssd/storage \
  /mnt/hdd/storage \
  /mnt/ssd/deniz-cloud \
  /mnt/hdd/deniz-cloud \
  /srv/deniz-cloud/storage \
  /srv/deniz-cloud/namespace \
  /opt/deniz-cloud; do
  if [[ "$root" == "$protected_root" || "$root" == "$protected_root/"* \
    || "$protected_root" == "$root/"* ]]; then
    echo "Metadata root overlaps a protected production path" >&2
    exit 1
  fi
done

marker="$root/.posix-gate1-metadata"
marker_content="deniz-cloud-posix-gate1-metadata:${run_id}"
if [[ ! -d "$root" || -L "$root" || "$(realpath "$root" 2>/dev/null || true)" != "$root" ]]; then
  echo "Metadata root must be an existing real directory" >&2
  exit 1
fi
if [[ ! -f "$marker" || -L "$marker" || "$(cat "$marker")" != "$marker_content" ]]; then
  echo "Metadata root marker is missing or mismatched" >&2
  exit 1
fi

if [[ -n "$evidence" ]]; then
  if [[ "$evidence" != /* || "$evidence" == *//* || "$evidence" == */./* || "$evidence" == */../* \
    || "$evidence" == */. || "$evidence" == */.. ]]; then
    echo "Evidence path must be normalized and absolute" >&2
    exit 1
  fi
  if [[ "$evidence" == "$root" || "$evidence" == "$root/"* ]]; then
    echo "Evidence must stay outside the metadata namespace" >&2
    exit 1
  fi
  for protected_root in \
    /data/ssd \
    /data/hdd \
    /mnt/ssd/storage \
    /mnt/hdd/storage \
    /mnt/ssd/deniz-cloud \
    /mnt/hdd/deniz-cloud \
    /srv/deniz-cloud/storage \
    /srv/deniz-cloud/namespace \
    /opt/deniz-cloud; do
    if [[ "$evidence" == "$protected_root" || "$evidence" == "$protected_root/"* ]]; then
      echo "Evidence overlaps a protected production path" >&2
      exit 1
    fi
  done
  evidence_parent="$(dirname "$evidence")"
  if [[ ! -d "$evidence_parent" || -L "$evidence_parent" \
    || "$(realpath "$evidence_parent" 2>/dev/null || true)" != "$evidence_parent" \
    || -L "$evidence" || ( -e "$evidence" && ! -f "$evidence" ) ]]; then
    echo "Evidence path is unsafe" >&2
    exit 1
  fi
fi

if [[ "$mode" == "--dry-run" ]]; then
  jq -nc \
    --arg action "$action" \
    '{schemaVersion:1,mode:"dry-run",action:$action,writes:false,allGreen:false,credentialsInArguments:false}'
  exit 0
fi

for command in awk basename cat chmod chown dirname find getfattr grep jq od realpath sed setfattr sha256sum sort stat sync tr wc; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required metadata command is missing: ${command}" >&2
    exit 1
  fi
done

base="$root/metadata.bin"
copy="$root/metadata-copy.bin"
sidecar="$root/._metadata.bin"
copy_sidecar="$root/._metadata-copy.bin"
readonly owner_id="00000000-0000-4000-8000-000000000001"
readonly created_at="2026-08-05T00:00:00.000Z"
readonly base_content="deniz-cloud-gate1-metadata"
readonly max_evidence_bytes=65536
readonly -a protected_names=(
  user.denizcloud.id
  user.denizcloud.owner_id
  user.denizcloud.created_at
  user.denizcloud.schema_version
  user.denizcloud.checksum
)

base_hash="$(printf '%s\n' "$base_content" | sha256sum | awk '{print $1}')"
expected_value() {
  case "$1" in
    user.denizcloud.id) printf '%s' "$run_id" ;;
    user.denizcloud.owner_id) printf '%s' "$owner_id" ;;
    user.denizcloud.created_at) printf '%s' "$created_at" ;;
    user.denizcloud.schema_version) printf '1' ;;
    user.denizcloud.checksum) printf '%s' "$base_hash" ;;
    *) return 1 ;;
  esac
}

expected_metadata_digest="$({
  for name in "${protected_names[@]}"; do
    printf '%s=%s\n' "$name" "$(expected_value "$name")"
  done
} | sha256sum | awk '{print $1}')"

append_evidence() {
  local json="$1"
  [[ -n "$evidence" ]] || return 0
  local current_bytes=0 record_bytes
  if [[ -f "$evidence" ]]; then current_bytes="$(wc -c < "$evidence")"; fi
  record_bytes="$(printf '%s\n' "$json" | wc -c)"
  if (( current_bytes + record_bytes > max_evidence_bytes )); then
    echo "Metadata evidence reached its bounded size" >&2
    exit 1
  fi
  printf '%s\n' "$json" >> "$evidence"
  chmod 600 "$evidence"
}

protected_intact() {
  local name actual expected
  for name in "${protected_names[@]}"; do
    expected="$(expected_value "$name")"
    actual="$(getfattr --only-values -n "$name" -- "$base" 2>/dev/null)" || return 1
    [[ "$actual" == "$expected" ]] || return 1
  done
}

protected_attribute_count() {
  local path="$1"
  getfattr -m '^user\.denizcloud\.' --absolute-names -- "$path" 2>/dev/null \
    | sed '/^#/d;/^$/d' | wc -l | tr -d ' '
}

protected_alias_count() {
  getfattr -m - --absolute-names -- "$base" 2>/dev/null \
    | sed '/^#/d;/^$/d' \
    | grep -Eic '^user\.DosStream\.user\.denizcloud\.' || true
}

appledouble_valid() {
  [[ -f "$sidecar" && ! -L "$sidecar" && "$(stat -c '%h' "$sidecar")" == "1" ]] || return 1
  [[ "$(od -An -tx1 -N4 "$sidecar" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')" == "00051607" ]]
}

validate_seed_state() {
  local entries
  entries="$(find "$root" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
  [[ "$entries" == ".posix-gate1-metadata" ]]
}

validate_base() {
  [[ -f "$base" && ! -L "$base" && "$(stat -c '%h' "$base")" == "1" ]]
}

seed_metadata() {
  local root_owner
  validate_seed_state || { echo "Metadata seed root is not empty" >&2; exit 1; }
  printf '%s\n' "$base_content" > "$base"
  root_owner="$(stat -c '%u:%g' "$root")"
  if [[ "$(stat -c '%u:%g' "$base")" != "$root_owner" ]]; then
    chown "$root_owner" "$base"
  fi
  chmod 660 "$base"
  local name
  for name in "${protected_names[@]}"; do
    setfattr -n "$name" -v "$(expected_value "$name")" -- "$base"
  done
  sync -f "$base"
  sync -f "$root"
  protected_intact
  local result
  result="$(jq -nc \
    --arg action seed \
    --arg baseHash "$base_hash" \
    --arg metadataDigest "$expected_metadata_digest" \
    --argjson protectedCount "${#protected_names[@]}" \
    '{schemaVersion:1,action:$action,ok:true,baseHash:$baseHash,protectedMetadataDigest:$metadataDigest,protectedCount:$protectedCount}')"
  append_evidence "$result"
  printf '%s\n' "$result"
}

verify_metadata() {
  validate_base || { echo "Metadata base is missing or unsafe" >&2; exit 1; }
  local intact=false base_exact=false sidecar_present=false sidecar_valid=false
  local copy_present=false copy_exact=false copy_protected=0 copy_sidecar_present=false
  local alias_count=0 unexpected_entries=0 unsafe_entries=0 all_green=false
  local entry entry_name
  protected_intact && intact=true
  [[ "$(sha256sum "$base" | awk '{print $1}')" == "$base_hash" ]] && base_exact=true
  alias_count="$(protected_alias_count)"
  if [[ -e "$sidecar" || -L "$sidecar" ]]; then sidecar_present=true; fi
  appledouble_valid && sidecar_valid=true
  if [[ -f "$copy" && ! -L "$copy" ]]; then
    copy_present=true
    [[ "$(sha256sum "$copy" | awk '{print $1}')" == "$base_hash" ]] && copy_exact=true
    copy_protected="$(protected_attribute_count "$copy")"
  fi
  if [[ -e "$copy_sidecar" || -L "$copy_sidecar" ]]; then copy_sidecar_present=true; fi
  while IFS= read -r -d '' entry; do
    entry_name="$(basename "$entry")"
    case "$entry_name" in
      .posix-gate1-metadata|metadata.bin|metadata-copy.bin|._metadata.bin|._metadata-copy.bin) ;;
      *) unexpected_entries=$((unexpected_entries + 1)) ;;
    esac
    if [[ ! -f "$entry" || -L "$entry" || "$(stat -c '%h' "$entry" 2>/dev/null || printf 0)" != "1" ]]; then
      unsafe_entries=$((unsafe_entries + 1))
    fi
  done < <(find "$root" -mindepth 1 -maxdepth 1 -print0)
  if [[ "$intact" == "true" && "$base_exact" == "true" && "$sidecar_valid" == "true" \
    && "$copy_present" == "true" && "$copy_exact" == "true" && "$copy_protected" == "0" \
    && "$alias_count" == "0" && "$unexpected_entries" == "0" && "$unsafe_entries" == "0" ]]; then
    all_green=true
  fi
  local result
  result="$(jq -nc \
    --arg action verify \
    --arg metadataDigest "$expected_metadata_digest" \
    --argjson protectedIntact "$intact" \
    --argjson baseExact "$base_exact" \
    --argjson protectedAliasCount "$alias_count" \
    --argjson appleDoublePresent "$sidecar_present" \
    --argjson appleDoubleValid "$sidecar_valid" \
    --argjson copyPresent "$copy_present" \
    --argjson copyExact "$copy_exact" \
    --argjson copyProtectedCount "$copy_protected" \
    --argjson copyAppleDoublePresent "$copy_sidecar_present" \
    --argjson unexpectedEntries "$unexpected_entries" \
    --argjson unsafeEntries "$unsafe_entries" \
    --argjson allGreen "$all_green" \
    '{schemaVersion:1,action:$action,allGreen:$allGreen,protectedIntact:$protectedIntact,baseExact:$baseExact,protectedMetadataDigest:$metadataDigest,protectedNamedStreamAliases:$protectedAliasCount,appleDouble:{present:$appleDoublePresent,valid:$appleDoubleValid},copy:{present:$copyPresent,exactBytes:$copyExact,protectedXattrs:$copyProtectedCount,appleDoublePresent:$copyAppleDoublePresent},namespace:{unexpectedEntries:$unexpectedEntries,unsafeEntries:$unsafeEntries}}')"
  append_evidence "$result"
  printf '%s\n' "$result"
  [[ "$all_green" == "true" ]]
}

run_smb_adversarial() {
  validate_base || { echo "Metadata base is missing or unsafe" >&2; exit 1; }
  local smb_host="${POSIX_GATE1_SMB_HOST:-}"
  local smb_share="${POSIX_GATE1_SMB_SHARE:-}"
  local auth_file="${POSIX_GATE1_SMB_AUTH_FILE:-}"
  local temporary remote share auth_mode
  if [[ ! "$smb_host" =~ ^[A-Za-z0-9._-]+$ || ! "$smb_share" =~ ^[A-Za-z0-9._$-]+$ \
    || "$auth_file" != /* || ! -f "$auth_file" || -L "$auth_file" ]]; then
    echo "Private SMB environment is missing or unsafe" >&2
    exit 1
  fi
  auth_mode="$(stat -c '%a' "$auth_file")"
  if [[ "$auth_mode" != "400" && "$auth_mode" != "600" ]]; then
    echo "Private SMB authentication file permissions are unsafe" >&2
    exit 1
  fi
  if ! command -v smbclient >/dev/null 2>&1; then
    echo "Required metadata command is missing: smbclient" >&2
    exit 1
  fi
  if ! command -v mktemp >/dev/null 2>&1; then
    echo "Required metadata command is missing: mktemp" >&2
    exit 1
  fi

  temporary="$(mktemp -d /tmp/posix-gate1-metadata.XXXXXX)"
  remote="$(basename "$root")"
  share="//${smb_host}/${smb_share}"
  cleanup_smb_metadata() {
    set +e
    if [[ "$temporary" == /tmp/posix-gate1-metadata.* && -d "$temporary" ]]; then
      find "$temporary" -xdev -depth -delete
    fi
  }
  trap cleanup_smb_metadata EXIT HUP INT TERM

  printf 'client-reserved-name-attempt\n' > "$temporary/attack.bin"
  printf 'gate1-resource-fork\n' > "$temporary/resource.bin"

  local protected_read_exposed=false protected_write_accepted=false
  local protected_alias_roundtrip=false protected_raw_unchanged=false
  local resource_roundtrip=false sidecar_smb_visible=false
  local copy_protected=0 copy_alias_visible=false copy_exact=false sidecar_valid=false all_green=false

  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "get ${remote}/metadata.bin:user.denizcloud.id ${temporary}/protected-read.bin" >/dev/null 2>&1; then
    protected_read_exposed=true
  fi
  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "put ${temporary}/attack.bin ${remote}/metadata.bin:user.denizcloud.id" >/dev/null 2>&1; then
    protected_write_accepted=true
  fi
  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "get ${remote}/metadata.bin:user.denizcloud.id ${temporary}/attack-out.bin" >/dev/null 2>&1 \
    && [[ "$(sha256sum "$temporary/attack.bin" | awk '{print $1}')" == "$(sha256sum "$temporary/attack-out.bin" | awk '{print $1}')" ]]; then
    protected_alias_roundtrip=true
  fi
  protected_intact && protected_raw_unchanged=true

  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "put ${temporary}/resource.bin ${remote}/metadata.bin:AFP_Resource; get ${remote}/metadata.bin:AFP_Resource ${temporary}/resource-out.bin" >/dev/null 2>&1 \
    && [[ "$(sha256sum "$temporary/resource.bin" | awk '{print $1}')" == "$(sha256sum "$temporary/resource-out.bin" | awk '{print $1}')" ]]; then
    resource_roundtrip=true
  fi
  appledouble_valid && sidecar_valid=true
  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "allinfo ${remote}/._metadata.bin" >/dev/null 2>&1; then
    sidecar_smb_visible=true
  fi

  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "get ${remote}/metadata.bin ${temporary}/base.bin; put ${temporary}/base.bin ${remote}/metadata-copy.bin" >/dev/null 2>&1; then
    [[ "$(sha256sum "$temporary/base.bin" | awk '{print $1}')" == "$base_hash" ]] && copy_exact=true
  fi
  if [[ -f "$copy" && ! -L "$copy" ]]; then
    copy_protected="$(protected_attribute_count "$copy")"
  fi
  if smbclient "$share" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "get ${remote}/metadata-copy.bin:user.denizcloud.id ${temporary}/copy-stream.bin" >/dev/null 2>&1; then
    copy_alias_visible=true
  fi

  if [[ "$protected_read_exposed" == "false" && "$protected_write_accepted" == "false" \
    && "$protected_alias_roundtrip" == "false" && "$protected_raw_unchanged" == "true" \
    && "$resource_roundtrip" == "true" && "$sidecar_valid" == "true" \
    && "$sidecar_smb_visible" == "false" && "$copy_exact" == "true" \
    && "$copy_protected" == "0" && "$copy_alias_visible" == "false" ]]; then
    all_green=true
  fi

  local result
  result="$(jq -nc \
    --arg action smb-adversarial \
    --argjson allGreen "$all_green" \
    --argjson protectedReadExposed "$protected_read_exposed" \
    --argjson protectedWriteAccepted "$protected_write_accepted" \
    --argjson protectedAliasRoundTrip "$protected_alias_roundtrip" \
    --argjson protectedRawUnchanged "$protected_raw_unchanged" \
    --argjson resourceRoundTrip "$resource_roundtrip" \
    --argjson appleDoubleValid "$sidecar_valid" \
    --argjson appleDoubleVisibleOverSmb "$sidecar_smb_visible" \
    --argjson copyExact "$copy_exact" \
    --argjson copyProtectedCount "$copy_protected" \
    --argjson copyAliasVisible "$copy_alias_visible" \
    '{schemaVersion:1,action:$action,allGreen:$allGreen,protected:{readExposed:$protectedReadExposed,reservedNameWriteAccepted:$protectedWriteAccepted,reservedAliasRoundTrip:$protectedAliasRoundTrip,rawUnchanged:$protectedRawUnchanged},resourceFork:{roundTrip:$resourceRoundTrip,appleDoubleValid:$appleDoubleValid,appleDoubleVisibleOverSmb:$appleDoubleVisibleOverSmb},copy:{exactBytes:$copyExact,protectedXattrs:$copyProtectedCount,reservedAliasVisible:$copyAliasVisible}}')"
  append_evidence "$result"
  printf '%s\n' "$result"
  trap - EXIT HUP INT TERM
  cleanup_smb_metadata
  [[ "$all_green" == "true" ]]
}

cleanup_metadata() {
  if [[ "$root" != */"posix-gate1-metadata-${run_id}" || ! -f "$marker" || -L "$marker" ]]; then
    echo "Refusing unsafe metadata cleanup" >&2
    exit 1
  fi
  find "$root" -xdev -depth -delete
  local result
  result="$(jq -nc --arg action cleanup '{schemaVersion:1,action:$action,ok:true,removed:true}')"
  append_evidence "$result"
  printf '%s\n' "$result"
}

case "$action" in
  seed) seed_metadata ;;
  smb-adversarial) run_smb_adversarial ;;
  verify) verify_metadata ;;
  cleanup) cleanup_metadata ;;
esac
