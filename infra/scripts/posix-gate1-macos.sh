#!/bin/bash

set -euo pipefail
set +x

umask 077

mode="--dry-run"
server=""
share=""
mount_path=""
evidence_path=""

usage() {
  cat >&2 <<'EOF'
Usage: posix-gate1-macos.sh [--dry-run|--execute] --host HOST --share SHARE [--mount PATH] [--evidence PATH]

The execute mode uses the macOS SMB redirector and Finder's credential prompt or
an existing Keychain credential. It does not exercise Finder UI workflows or a
real Office application. It never accepts a username or password. The target
share must not contain production data: this probe creates and removes a unique
test folder.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --dry-run|--execute)
      mode="$1"
      shift
      ;;
    --host)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      server="$2"
      shift 2
      ;;
    --share)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      share="$2"
      shift 2
      ;;
    --mount)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      mount_path="$2"
      shift 2
      ;;
    --evidence)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      evidence_path="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$server" || -z "$share" ]]; then
  usage
  exit 2
fi
if [[ ! "$server" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "HOST contains unsupported characters" >&2
  exit 2
fi
if [[ ! "$share" =~ ^[A-Za-z0-9._$-]+$ ]]; then
  echo "SHARE contains unsupported characters" >&2
  exit 2
fi
if [[ -z "$mount_path" ]]; then
  mount_path="/Volumes/$share"
fi
if [[ ! "$mount_path" =~ ^/Volumes/[A-Za-z0-9._\ $-]+$ ]]; then
  echo "The mount path must be one specific, conventionally named volume below /Volumes" >&2
  exit 2
fi

if [[ "$mode" == "--dry-run" ]]; then
  printf '{"mode":"dry-run","platform":"macos","host":"%s","share":"%s","mount":"%s","writes":false,"credentials":"Finder/Keychain prompt only","coverage":["macOS SMB redirector","filesystem operations","resource-fork round trip","disconnect/reconnect"],"excludedCoverage":["Finder UI workflows","Quick Look and thumbnails","real Office application saves","sleep and network-loss recovery"]}\n' \
    "$server" "$share" "$mount_path"
  exit 0
fi

for command in open mount smbutil diskutil shasum uuidgen xattr find mktemp sync; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done

run_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
if [[ -z "$evidence_path" ]]; then
  evidence_dir="$HOME/Library/Application Support/deniz-cloud/posix-gate1"
  evidence_path="$evidence_dir/macos-${run_id}.jsonl"
else
  evidence_dir="$(dirname "$evidence_path")"
fi
mkdir -p "$evidence_dir"
if [[ -e "$evidence_path" || -L "$evidence_path" ]]; then
  echo "Refusing to overwrite evidence: ${evidence_path}" >&2
  exit 1
fi
touch "$evidence_path"
chmod 600 "$evidence_path"

record() {
  local event="$1"
  local status="$2"
  local details="${3:-{}}"
  local timestamp
  timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  printf '{"schemaVersion":1,"timestamp":"%s","runId":"%s","platform":"macos","host":"%s","share":"%s","event":"%s","status":"%s","details":%s}\n' \
    "$timestamp" "$run_id" "$server" "$share" "$event" "$status" "$details" >> "$evidence_path"
}

mounted_source() {
  local line
  line="$(mount | awk -v target="$mount_path" 'index($0, " on " target " (") { print; exit }')"
  [[ -n "$line" ]] || return 1
  printf '%s' "${line%% on *}"
}

verify_target_mount() {
  local source authority mounted_server mounted_share normalized_mounted_server normalized_server
  source="$(mounted_source)" || return 1
  [[ "$source" == //* ]] || return 1
  authority="${source#//}"
  authority="${authority#*@}"
  mounted_server="${authority%%/*}"
  mounted_share="${authority#*/}"
  normalized_mounted_server="$(printf '%s' "$mounted_server" | tr '[:upper:]' '[:lower:]')"
  normalized_server="$(printf '%s' "$server" | tr '[:upper:]' '[:lower:]')"
  [[ "$normalized_mounted_server" == "$normalized_server" && "$mounted_share" == "$share" ]]
}

wait_for_mount() {
  local attempt
  for attempt in {1..120}; do
    if [[ -d "$mount_path" ]] && verify_target_mount; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_unmount() {
  local attempt
  for attempt in {1..40}; do
    if ! mounted_source >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

connect_share() {
  if [[ -d "$mount_path" ]] && verify_target_mount; then
    return 0
  fi
  open "smb://${server}/${share}" >/dev/null
  wait_for_mount
}

local_work="$(mktemp -d "${TMPDIR:-/tmp}/posix-gate1-macos.XXXXXX")"
remote_root="$mount_path/.posix-gate1-${run_id}"
remote_created=false
session_connected=false

cleanup() {
  set +e
  if [[ "$remote_created" == "true" ]] && verify_target_mount \
    && [[ "$remote_root" == "$mount_path/.posix-gate1-${run_id}" ]]; then
    rm -rf -- "$remote_root"
  fi
  if [[ "$session_connected" == "true" ]] && verify_target_mount; then
    diskutil unmount "$mount_path" >/dev/null 2>&1
  fi
  if [[ "$local_work" == "${TMPDIR:-/tmp}/posix-gate1-macos."* ]]; then
    rm -rf -- "$local_work"
  fi
}
trap cleanup EXIT HUP INT TERM

run_probe() {
  local name="$1"
  local result
  shift
  if "$@"; then
    record "$name" "pass"
    return 0
  else
    result=$?
  fi
  record "$name" "fail" "{\"exitCode\":${result}}"
  echo "Probe failed: ${name}; evidence: ${evidence_path}" >&2
  exit "$result"
}

probe_connect() {
  connect_share || return
  verify_target_mount || return
  session_connected=true
}

probe_no_existing_session() {
  ! mounted_source >/dev/null 2>&1 && [[ ! -e "$mount_path" ]]
}

probe_create_root() {
  mkdir "$remote_root" || return
  remote_created=true
}

observe_transport() {
  local event="$1"
  local stats dialect current_encryption encryption_required encryption_state observable normalized_encryption observation_status
  stats="$(smbutil statshares -m "$mount_path" 2>/dev/null)" || return 1
  dialect="$(printf '%s\n' "$stats" | awk '$1 == "SMB_VERSION" {print $2; exit}')"
  [[ "$dialect" == SMB_3* || "$dialect" == 3.* ]] || return 1

  current_encryption="$(printf '%s\n' "$stats" | awk '$1 == "SMB_CURR_ENCRYPT_ALGORITHM" || $1 == "CURRENT_ENCRYPTION_ALGORITHM" {print $2; exit}')"
  encryption_required="$(printf '%s\n' "$stats" | awk '$1 == "ENCRYPTION_REQUIRED" || $1 == "SHARE_ENCRYPTED" || $1 == "SESSION_ENCRYPTED" {print $2; exit}')"
  observable=false
  encryption_state=unknown
  if [[ -n "$current_encryption" ]]; then
    observable=true
    normalized_encryption="$(printf '%s' "$current_encryption" | tr '[:lower:]' '[:upper:]')"
    case "$normalized_encryption" in
      OFF|NONE|FALSE|0) encryption_state=false ;;
      *) encryption_state=true ;;
    esac
  elif [[ -n "$encryption_required" ]]; then
    observable=true
    normalized_encryption="$(printf '%s' "$encryption_required" | tr '[:lower:]' '[:upper:]')"
    case "$normalized_encryption" in
      TRUE|YES|ON|1) encryption_state=true ;;
      *) encryption_state=false ;;
    esac
  fi
  observation_status=fail
  if [[ "$observable" == "true" && "$encryption_state" == "true" ]]; then
    observation_status=pass
  fi
  record "$event" "$observation_status" "{\"dialect\":\"${dialect}\",\"encryptionObservable\":${observable},\"encrypted\":\"${encryption_state}\"}"
  [[ "$observable" == "true" && "$encryption_state" == "true" ]]
}

probe_transport() {
  observe_transport "transport-observation"
}

probe_enumeration() {
  mkdir "$remote_root/enumeration" || return
  printf 'alpha\n' > "$remote_root/enumeration/alpha.txt" || return
  printf 'unicode\n' > "$remote_root/enumeration/café-東京.txt" || return
  [[ "$(find "$remote_root/enumeration" -mindepth 1 -maxdepth 1 -type f | wc -l | tr -d ' ')" == "2" ]]
}

probe_transfer_hashes() {
  dd if=/dev/urandom of="$local_work/upload.bin" bs=1048576 count=1 2>/dev/null || return
  local expected uploaded downloaded
  expected="$(shasum -a 256 "$local_work/upload.bin" | awk '{print $1}')" || return
  cp "$local_work/upload.bin" "$remote_root/upload.bin" || return
  uploaded="$(shasum -a 256 "$remote_root/upload.bin" | awk '{print $1}')" || return
  cp "$remote_root/upload.bin" "$local_work/download.bin" || return
  downloaded="$(shasum -a 256 "$local_work/download.bin" | awk '{print $1}')" || return
  [[ "$expected" == "$uploaded" && "$expected" == "$downloaded" ]]
}

probe_rename() {
  printf 'rename\n' > "$remote_root/rename-source.txt" || return
  mv "$remote_root/rename-source.txt" "$remote_root/renamed.txt" || return
  [[ ! -e "$remote_root/rename-source.txt" && -f "$remote_root/renamed.txt" ]]
}

probe_case_rename() {
  printf 'case\n' > "$remote_root/CaseProbe.txt" || return
  mv "$remote_root/CaseProbe.txt" "$remote_root/caseprobe.txt" || return
  find "$remote_root" -mindepth 1 -maxdepth 1 -name 'caseprobe.txt' -print \
    | grep -q '/caseprobe\.txt$'
}

probe_overwrite() {
  local expected actual
  printf 'old-content\n' > "$remote_root/overwrite.txt" || return
  printf 'new-content-with-different-length\n' > "$local_work/overwrite.txt" || return
  cp -f "$local_work/overwrite.txt" "$remote_root/overwrite.txt" || return
  expected="$(shasum -a 256 "$local_work/overwrite.txt" | awk '{print $1}')" || return
  actual="$(shasum -a 256 "$remote_root/overwrite.txt" | awk '{print $1}')" || return
  [[ "$expected" == "$actual" ]]
}

probe_resource_fork() {
  local actual
  printf 'resource-fork-base\n' > "$remote_root/resource-fork.txt" || return
  xattr -wx com.apple.ResourceFork 67617465312d7265736f757263652d666f726b "$remote_root/resource-fork.txt" || return
  actual="$(xattr -px com.apple.ResourceFork "$remote_root/resource-fork.txt" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')" || return
  [[ "$actual" == "67617465312d7265736f757263652d666f726b" ]]
}

probe_temp_replace() {
  local expected actual
  printf 'replace-old\n' > "$remote_root/replace-target.bin" || return
  printf 'replace-new\n' > "$remote_root/.replace-${run_id}.tmp" || return
  mv -f "$remote_root/.replace-${run_id}.tmp" "$remote_root/replace-target.bin" || return
  actual="$(shasum -a 256 "$remote_root/replace-target.bin" | awk '{print $1}')" || return
  expected="$(printf 'replace-new\n' | shasum -a 256 | awk '{print $1}')" || return
  [[ "$actual" == "$expected" ]]
}

probe_reconnect() {
  local expected actual
  sync || return
  diskutil unmount "$mount_path" >/dev/null || return
  wait_for_unmount || return
  session_connected=false
  open "smb://${server}/${share}" >/dev/null || return
  wait_for_mount || return
  session_connected=true
  actual="$(shasum -a 256 "$remote_root/upload.bin" | awk '{print $1}')" || return
  expected="$(shasum -a 256 "$local_work/upload.bin" | awk '{print $1}')" || return
  [[ "$actual" == "$expected" ]] || return
  observe_transport "transport-after-reconnect-observation"
}

probe_remote_cleanup() {
  [[ "$remote_created" == "true" && "$remote_root" == "$mount_path/.posix-gate1-${run_id}" ]]
  rm -rf -- "$remote_root" || return
  [[ ! -e "$remote_root" ]]
  remote_created=false
}

probe_disconnect() {
  [[ "$session_connected" == "true" ]] || return 1
  diskutil unmount "$mount_path" >/dev/null || return
  wait_for_unmount || return
  session_connected=false
}

record "run" "start"
record "coverage" "pass" '{"measured":["macOS SMB redirector","filesystem operations","resource-fork round trip","disconnect/reconnect"],"excluded":["Finder UI workflows","Quick Look and thumbnails","real Office application saves","sleep and network-loss recovery"]}'
run_probe "existing-session-preflight" probe_no_existing_session
run_probe "connect" probe_connect
run_probe "transport" probe_transport
run_probe "test-root-create" probe_create_root
run_probe "enumeration" probe_enumeration
run_probe "upload-download-sha256" probe_transfer_hashes
run_probe "rename" probe_rename
run_probe "case-only-rename" probe_case_rename
run_probe "overwrite" probe_overwrite
run_probe "resource-fork" probe_resource_fork
run_probe "temp-file-replace" probe_temp_replace
run_probe "reconnect" probe_reconnect
run_probe "remote-cleanup" probe_remote_cleanup
run_probe "disconnect" probe_disconnect
record "run" "pass"

printf '{"mode":"execute","platform":"macos","host":"%s","share":"%s","status":"pass","coverage":"macOS SMB redirector filesystem semantics only","evidence":"%s"}\n' \
  "$server" "$share" "$evidence_path"
