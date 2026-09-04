#!/usr/bin/env bash

# Shared, deliberately small primitives for disaster-recovery commands.
# Callers enable their own strict mode so this file can also be sourced by tests.

DR_SCHEMA_VERSION=1

# Cleanup that has to run even when a command aborts.
#
# `dr_die` exits, and an `exit` does not fire a function's RETURN trap. So
# every fatal path taken after a remote host lock was acquired left that lock
# behind — and a held host lock is exactly what the release workflows refuse to
# deploy through, so one failed offsite sync stopped deploys until an operator
# removed the directory by hand. Handlers registered here run on `dr_die`, and
# on any other exit once `dr_install_exit_cleanup` has been called.
#
# A handler must be idempotent and must not fail the exit: it can run after the
# thing it releases is already gone, or twice if a RETURN trap got there first.
dr_cleanup_handlers=()

dr_on_exit() {
  dr_cleanup_handlers[${#dr_cleanup_handlers[@]}]="$1"
}

dr_run_cleanup() {
  local index
  index=${#dr_cleanup_handlers[@]}
  while ((index > 0)); do
    index=$((index - 1))
    eval "${dr_cleanup_handlers[index]}" || true
  done
  dr_cleanup_handlers=()
}

dr_install_exit_cleanup() {
  trap dr_run_cleanup EXIT
}

dr_die() {
  printf 'STOP: %s\n' "$*" >&2
  dr_run_cleanup
  exit 1
}

# Shell-quotes its arguments into one string, for building a deferred command.
# `printf %q` rather than ${x@Q} because /bin/bash here is 3.2.
dr_quote() {
  local part out=""
  for part in "$@"; do
    out+="$(printf '%q' "$part") "
  done
  printf '%s' "${out% }"
}

dr_note() {
  printf '%s\n' "$*" >&2
}

dr_require_commands() {
  local command
  for command in "$@"; do
    command -v "$command" >/dev/null 2>&1 || dr_die "required command is missing: ${command}"
  done
}

dr_require_private_file() {
  local path="$1" mode
  [[ -f "$path" && ! -L "$path" ]] || dr_die "required private file is missing or unsafe: ${path}"
  # GNU stat accepts -f, but it means "file-system status" rather than the
  # BSD/macOS format flag. Probe the GNU form first so its diagnostic output
  # cannot be mistaken for a permission mode on Linux.
  if mode="$(stat -c '%a' "$path" 2>/dev/null)"; then
    :
  else
    mode="$(stat -f '%Lp' "$path")"
  fi
  [[ "$mode" == 600 || "$mode" == 400 ]] || dr_die "private file must have mode 0600 or 0400: ${path} (is ${mode})"
}

dr_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

dr_bytes_available() {
  df -Pk "$1" | awk 'NR == 2 {print $4 * 1024}'
}

dr_required_disk_bytes() {
  local restored_bytes="$1" image_bytes="$2" required
  [[ "$restored_bytes" =~ ^[0-9]+$ && "$image_bytes" =~ ^[0-9]+$ &&
     ${#restored_bytes} -le 16 && ${#image_bytes} -le 16 &&
     "$restored_bytes" -le 1000000000000000 && "$image_bytes" -le 1000000000000000 ]] \
    || dr_die "restore or image footprint is invalid or exceeds the 1 PB safety bound"
  required=$(( (restored_bytes * 225 + 99) / 100 + image_bytes + 30000000000 ))
  ((required >= 300000000000)) || required=300000000000
  printf '%s\n' "$required"
}

dr_assert_recovery_preflight_compatible() {
  local report="$1" current="$2"
  jq -e --slurpfile current "$current" '
    (.preflight | del(.oldestSnapshotAgeSeconds,.stale,.staleAccepted,.cutoverRequested,.intendedMutations)) ==
    ($current[0] | del(.oldestSnapshotAgeSeconds,.stale,.staleAccepted,.cutoverRequested,.intendedMutations))
  ' "$report" >/dev/null || dr_die "existing recovery checkpoint has incompatible preflight evidence"
}

dr_iso8601_epoch() {
  local value="$1"
  [[ "$value" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || dr_die "invalid UTC timestamp: ${value}"
  if date -u -d "$value" +%s >/dev/null 2>&1; then
    date -u -d "$value" +%s
  else
    date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$value" +%s
  fi
}

dr_json_canonical() {
  jq -S -c . "$1"
}

dr_json_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    dr_json_canonical "$1" | sha256sum | awk '{print $1}'
  else
    dr_json_canonical "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

dr_validate_json() {
  local schema="$1" document="$2"
  jq -e . "$document" >/dev/null || dr_die "invalid JSON: ${document}"
  # jsonschema is optional on production hosts. CI uses the full validator;
  # runtime still rejects a wrong contract version and absent required fields.
  local expected_type required
  expected_type="$(jq -r '.title // empty' "$schema")"
  required="$(jq -c '.required // []' "$schema")"
  jq -e --argjson version "$DR_SCHEMA_VERSION" --argjson required "$required" '
    . as $document | .schemaVersion == $version and
    all($required[]; . as $key | $document | has($key))
  ' "$document" >/dev/null || dr_die "${expected_type:-document} does not satisfy the runtime contract: ${document}"
}

dr_assert_forge_control_plane_pair() {
  local pi_inventory="$1" forge_inventory="$2"
  for inventory in "$pi_inventory" "$forge_inventory"; do
    jq -e '
      type=="array" and length>0 and ([.[].deploymentId]|unique|length)==length and
      all(.[]; . as $item |
        ($item.deploymentId|test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
        ($item.imageReference|test("^ghcr\\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$")) and
        ($item.imageDigest|test("^sha256:[0-9a-f]{64}$")) and
        ($item.imageReference|endswith("@" + $item.imageDigest)) and
        ($item.hostname|type=="string" and test("^[A-Za-z0-9.-]+\\.[A-Za-z0-9.-]+$")))
    ' "$inventory" >/dev/null || dr_die "invalid Forge control-plane pairing inventory: ${inventory}"
  done
  cmp -s "$pi_inventory" "$forge_inventory" \
    || dr_die "selected Pi PostgreSQL and Forge image snapshots describe different production deployments"
}

dr_sign_file() {
  local key="$1" namespace="$2" input="$3" output="$4" generated="${3}.sig"
  dr_require_private_file "$key"
  rm -f -- "$generated"
  ssh-keygen -q -Y sign -f "$key" -n "$namespace" "$input" >/dev/null
  [[ "$generated" == "$output" ]] || mv -- "$generated" "$output"
  chmod 0600 "$output"
}

dr_verify_file() {
  local allowed_signers="$1" identity="$2" namespace="$3" signature="$4" input="$5"
  [[ -f "$allowed_signers" && ! -L "$allowed_signers" ]] || dr_die "allowed signers file is missing: ${allowed_signers}"
  [[ -f "$signature" && ! -L "$signature" ]] || dr_die "signature is missing: ${signature}"
  ssh-keygen -q -Y verify -f "$allowed_signers" -I "$identity" -n "$namespace" -s "$signature" < "$input" >/dev/null \
    || dr_die "signature verification failed for ${input}"
}

dr_assert_safe_relative_path() {
  local value="$1"
  [[ -n "$value" && "$value" != /* && "$value" != *$'\n'* ]] || dr_die "unsafe relative path: ${value}"
  [[ "/${value}/" != *'/../'* && "/${value}/" != *'/./'* ]] || dr_die "unsafe relative path: ${value}"
}

dr_assert_restic_object_path() {
  local value="$1"
  dr_assert_safe_relative_path "$value"
  [[ "$value" == config || "$value" =~ ^data/[0-9a-f]{2}/[0-9a-f]{64}$ ||
     "$value" =~ ^(index|keys|snapshots)/[0-9a-f]{64}$ ]] \
    || dr_die "unsafe restic repository object path: ${value}"
}

# Refuse a symlink or non-directory anywhere below a managed root before a
# caller creates descendants. This is deliberately lexical: resolving a path
# with realpath would already follow the symlink this guard exists to reject.
dr_assert_managed_directory_path() {
  local root="$1" path="$2" relative component current
  [[ "$root" == /* && "$root" != / && "$root" != */ && "$root" != *$'\n'* ]] \
    || dr_die "unsafe managed root: ${root}"
  [[ "$path" == "$root" || "$path" == "$root/"* ]] \
    || dr_die "managed path escapes its root: ${path}"
  [[ ! -L "$root" ]] || dr_die "managed root is a symlink: ${root}"
  [[ ! -e "$root" || -d "$root" ]] || dr_die "managed root is not a directory: ${root}"
  relative="${path#"$root"}"
  relative="${relative#/}"
  current="$root"
  while [[ -n "$relative" ]]; do
    component="${relative%%/*}"
    [[ -n "$component" && "$component" != . && "$component" != .. ]] \
      || dr_die "unsafe managed directory component: ${path}"
    current="${current}/${component}"
    [[ ! -L "$current" ]] || dr_die "managed path contains a symlink: ${current}"
    [[ ! -e "$current" || -d "$current" ]] || dr_die "managed path contains a non-directory: ${current}"
    if [[ "$relative" == */* ]]; then relative="${relative#*/}"; else relative=""; fi
  done
}

dr_read_env_file() {
  local path="$1" line key value
  dr_require_private_file "$path"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || dr_die "invalid break-glass entry in ${path}"
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^DR_[A-Z0-9_]+$ ]] || dr_die "invalid break-glass key: ${key}"
    printf -v "$key" '%s' "$value"
    # key is the validated DR_* variable name.
    # shellcheck disable=SC2163
    export "$key"
  done < "$path"
}

dr_lock() {
  local lock_dir="$1" deadline="${2:-0}" now
  while ! mkdir "$lock_dir" 2>/dev/null; do
    if [[ -f "${lock_dir}/pid" ]]; then
      if ! kill -0 "$(cat "${lock_dir}/pid")" 2>/dev/null; then
        dr_die "stale lock requires operator review: ${lock_dir}"
      fi
    elif [[ ! -f "${lock_dir}/owner" ]]; then
      # mkdir is the cross-language no-replace operation. The unprivileged
      # deploy agent writes pid/owner immediately afterward, so tolerate this
      # publication window but never replace or remove the directory.
      :
    fi
    now="$(date +%s)"
    (( deadline > 0 )) || dr_die "another coordinated operation holds ${lock_dir}"
    (( now < deadline )) || dr_die "timed out waiting for ${lock_dir}"
    sleep 2
  done
  printf '%s\n' "$$" > "${lock_dir}/pid"
}

dr_unlock() {
  local lock_dir="$1"
  [[ -d "$lock_dir" && -f "${lock_dir}/pid" ]] || return 0
  [[ "$(cat "${lock_dir}/pid")" == "$$" ]] || dr_die "refusing to remove a lock owned by another process: ${lock_dir}"
  rm -f -- "${lock_dir}/pid"
  rmdir -- "$lock_dir"
}

# A phase is resumable only when its atomic marker agrees with the durable
# report record. The report is committed before the marker in dr_finish_phase,
# so an interrupted commit can only cause safe re-execution, never a skip.
dr_phase_done() {
  local report="$1" checkpoint_dir="$2" name="$3" checkpoint finished_at
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || dr_die "unsafe recovery phase name: ${name}"
  checkpoint="$checkpoint_dir/$name.done"
  [[ -e "$checkpoint" || -L "$checkpoint" ]] || return 1
  [[ -f "$checkpoint" && ! -L "$checkpoint" ]] \
    || dr_die "recovery checkpoint is not a regular file: ${checkpoint}"
  IFS= read -r finished_at < "$checkpoint"
  [[ "$finished_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || dr_die "recovery checkpoint has an invalid timestamp: ${checkpoint}"
  jq -e --arg name "$name" --arg finishedAt "$finished_at" '
    ([.phases[] | select(.name==$name)] | length)==1 and
    ([.phases[] | select(.name==$name and .status=="ok" and .finishedAt==$finishedAt)] | length)==1
  ' "$report" >/dev/null || dr_die "recovery checkpoint disagrees with its report phase: ${name}"
}

dr_begin_phase() {
  local report="$1" name="$2" now temporary
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || dr_die "unsafe recovery phase name: ${name}"
  now="$(date -u +%FT%TZ)"
  temporary="${report}.tmp.$$"
  jq -e --arg name "$name" --arg now "$now" '
    if ([.phases[] | select(.name==$name)] | length) <= 1 then .
    else error("duplicate recovery phase") end |
    .updatedAt=$now |
    .checks |= map(select(.name != ($name + " checkpoint"))) |
    if any(.phases[]; .name==$name) then
      .phases |= map(if .name==$name then .status="running" | .startedAt=$now | .finishedAt=$now else . end)
    else
      .phases += [{name:$name,status:"running",startedAt:$now,finishedAt:$now}]
    end
  ' "$report" > "$temporary" || {
    rm -f -- "$temporary"
    dr_die "could not begin recovery phase: ${name}"
  }
  mv -- "$temporary" "$report"
}

dr_finish_phase() {
  local report="$1" checkpoint_dir="$2" name="$3" now report_temporary checkpoint checkpoint_temporary
  [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] || dr_die "unsafe recovery phase name: ${name}"
  now="$(date -u +%FT%TZ)"
  report_temporary="${report}.tmp.$$"
  checkpoint="$checkpoint_dir/$name.done"
  checkpoint_temporary="${checkpoint}.tmp.$$"
  jq -e --arg name "$name" --arg now "$now" '
    if ([.phases[] | select(.name==$name and .status=="running")] | length)==1 then .
    else error("phase is not running exactly once") end |
    .updatedAt=$now |
    .phases |= map(if .name==$name then .status="ok" | .finishedAt=$now else . end) |
    .checks += [{name:($name + " checkpoint"),status:"ok",detail:"completed and checkpointed"}]
  ' "$report" > "$report_temporary" || {
    rm -f -- "$report_temporary"
    dr_die "could not finish recovery phase: ${name}"
  }
  mv -- "$report_temporary" "$report"
  printf '%s\n' "$now" > "$checkpoint_temporary"
  chmod 0600 "$checkpoint_temporary"
  mv -- "$checkpoint_temporary" "$checkpoint"
}
