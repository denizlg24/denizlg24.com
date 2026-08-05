#!/bin/bash

set -euo pipefail

umask 077

readonly storage_uid=1000
readonly storage_gid=1000
readonly smb_group=deniz-cloud-smb
readonly namespace_root=/srv/deniz-cloud/storage
readonly principal_pattern='^dc-[a-z0-9-]+-[0-9a-f]{8}$'
readonly uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

mode="--dry-run"
mode_set=false
action=""
principal=""
account_id=""

usage() {
  cat >&2 <<'USAGE'
Usage: posix-smb-credential.sh [--dry-run|--execute]
       (provision --principal NAME --account-id UUID | revoke --principal NAME
        | sessions | status --principal NAME)

provision creates a non-login Unix principal and a disabled Samba account whose
home is the account's namespace root. The reveal-once secret is read from
POSIX_SMB_SECRET on stdin-free input and never echoed or logged.

revoke disables the Samba account and closes its active sessions. It never
deletes the principal: a deleted account frees its name for reuse, and a reused
name is a different device wearing an old identity.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --dry-run | --execute)
      [[ "$mode_set" == false ]] || { usage; exit 2; }
      mode="$1"; mode_set=true; shift ;;
    provision | revoke | sessions | status)
      [[ -z "$action" ]] || { usage; exit 2; }
      action="$1"; shift ;;
    --principal)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      principal="$2"; shift 2 ;;
    --account-id)
      [[ $# -ge 2 && "$2" != --* ]] || { usage; exit 2; }
      account_id="$2"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n "$action" ]] || { usage; exit 2; }

if [[ "$action" == "provision" || "$action" == "revoke" || "$action" == "status" ]]; then
  # The principal becomes a Unix account name and reaches useradd, so it is
  # validated against an exact pattern rather than merely quoted.
  [[ "$principal" =~ $principal_pattern ]] || {
    echo "Principal must match ${principal_pattern}" >&2
    exit 1
  }
fi
if [[ "$action" == "provision" ]]; then
  [[ "$account_id" =~ $uuid_pattern ]] || {
    echo "A canonical lowercase account UUID is required" >&2
    exit 1
  }
fi

account_home="${namespace_root}/${account_id}"

if [[ "$mode" == "--dry-run" ]]; then
  jq -n \
    --arg action "$action" \
    --arg principal "$principal" \
    --arg accountId "$account_id" \
    --arg home "${account_id:+$account_home}" \
    '{mode:"--dry-run",action:$action,principal:$principal,
      accountId:(if $accountId=="" then null else $accountId end),
      home:(if $home=="" then null else $home end),
      writes:false,secretRevealed:false,deletesPrincipal:false}'
  exit 0
fi

((EUID == 0)) || { echo "Execute mode requires root" >&2; exit 1; }
for command in getent jq pdbedit smbcontrol smbstatus useradd usermod; do
  command -v "$command" >/dev/null || {
    echo "Missing command: ${command}" >&2
    exit 1
  }
done

provision() {
  [[ -n "${POSIX_SMB_SECRET:-}" ]] || {
    echo "POSIX_SMB_SECRET is required for provision" >&2
    return 1
  }
  [[ ${#POSIX_SMB_SECRET} -ge 24 ]] || {
    echo "POSIX_SMB_SECRET is too short" >&2
    return 1
  }
  [[ -d "$account_home" && ! -L "$account_home" ]] || {
    echo "Account namespace root is missing: ${account_home}" >&2
    return 1
  }
  getent group "$smb_group" >/dev/null || groupadd --system "$smb_group"

  # Step 1 of PROVISION_ORDER happens in the API before this runs. Here the
  # Unix principal is created non-login with no password of its own: SMB
  # authentication is Samba's, and a shell would make this a login account.
  if ! getent passwd "$principal" >/dev/null; then
    useradd --system --no-create-home --home-dir "$account_home" \
      --shell /usr/sbin/nologin --gid "$storage_gid" \
      --groups "$smb_group" "$principal"
    usermod --lock "$principal"
  fi

  # The account is created disabled, then enabled only after the secret is
  # accepted, so a failure part-way never leaves an enabled account with an
  # unknown password.
  if ! pdbedit -L -u "$principal" >/dev/null 2>&1; then
    printf '%s\n%s\n' "$POSIX_SMB_SECRET" "$POSIX_SMB_SECRET" \
      | smbpasswd -s -a "$principal" >/dev/null
    smbpasswd -d "$principal" >/dev/null
  fi
  pdbedit -u "$principal" --set-nt-hash >/dev/null 2>&1 || true
  smbpasswd -e "$principal" >/dev/null

  jq -n --arg principal "$principal" --arg home "$account_home" \
    '{provisioned:true,principal:$principal,home:$home,enabled:true,
      secretRevealed:false,shell:"nologin"}'
}

revoke() {
  getent passwd "$principal" >/dev/null || {
    echo "Unknown principal: ${principal}" >&2
    return 1
  }
  # Disable before closing sessions: closing first would leave a window in
  # which the client simply reconnects.
  smbpasswd -d "$principal" >/dev/null
  usermod --lock "$principal" || true

  # Disabling does not end an established session, so revocation is not
  # complete until the existing ones are gone.
  local closed=0 pid
  while read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    smbcontrol "$pid" close-share Personal >/dev/null 2>&1 || true
    smbcontrol "$pid" kill-client-ip >/dev/null 2>&1 || true
    kill -TERM "$pid" 2>/dev/null && closed=$((closed + 1)) || true
  done < <(smbstatus --json 2>/dev/null \
    | jq -r --arg u "$principal" '(.sessions // {}) | to_entries[] | select(.value.username == $u) | .value.pid' 2>/dev/null || true)

  local remaining
  remaining=$(smbstatus --json 2>/dev/null \
    | jq -r --arg u "$principal" '[(.sessions // {}) | to_entries[] | select(.value.username == $u)] | length' 2>/dev/null || echo 0)

  jq -n --arg principal "$principal" --argjson closed "$closed" \
    --argjson remaining "${remaining:-0}" \
    '{revoked:true,principal:$principal,sessionsClosed:$closed,
      sessionsRemaining:$remaining,principalDeleted:false,
      complete:($remaining == 0)}'
}

case "$action" in
  provision) provision ;;
  revoke) revoke ;;
  status)
    enabled=false
    pdbedit -L -u "$principal" >/dev/null 2>&1 && \
      ! pdbedit -Lv -u "$principal" 2>/dev/null | grep -q "Account Flags:.*D" && enabled=true
    jq -n --arg principal "$principal" --argjson enabled "$enabled" \
      --argjson exists "$(getent passwd "$principal" >/dev/null && echo true || echo false)" \
      '{principal:$principal,unixPrincipalExists:$exists,sambaEnabled:$enabled}' ;;
  sessions)
    smbstatus --json 2>/dev/null \
      | jq '{sessions:[(.sessions // {}) | to_entries[] | {username:.value.username,remote:.value.remote_machine,encryption:.value.encryption.cipher,dialect:.value.protocol_version}]}' ;;
esac
