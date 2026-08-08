#!/bin/bash

set -euo pipefail
umask 077

mode=--dry-run
action=status
mode_seen=false
action_seen=false
account_id=""

usage() {
  echo "Usage: $0 [--dry-run|--execute] [validate|compose-validate|mount|unmount|firewall-start|firewall-stop|broker-mount|broker-unmount|provision-account|watch|recover|status] [--account-id=UUID]" >&2
}

for argument in "$@"; do
  case "$argument" in
    --dry-run|--execute)
      [[ "$mode_seen" == false ]] || { usage; exit 2; }
      mode="$argument"; mode_seen=true ;;
    validate|compose-validate|mount|unmount|firewall-start|firewall-stop|broker-mount|broker-unmount|provision-account|watch|recover|status)
      [[ "$action_seen" == false ]] || { usage; exit 2; }
      action="$argument"; action_seen=true ;;
    --account-id=*) account_id=${argument#*=} ;;
    *) usage; exit 2 ;;
  esac
done

config=${DENIZ_POSIX_CONFIG:-/etc/deniz-cloud/posix-storage.env}
ssd_mount=/mnt/ssd
hdd_mount=/mnt/hdd
ssd_branch=/mnt/ssd/deniz-cloud/namespace
hdd_branch=/mnt/hdd/deniz-cloud/namespace
merged=/srv/deniz-cloud/storage
internal=/srv/deniz-cloud/internal
broker_mount=/srv/deniz-cloud/api-storage
# Numeric because the names differ per host; existing storage is 1000:1000.
storage_uid=1000
storage_gid=1000
metadata_socket=/run/deniz-cloud/storage-metadata.sock
credentials=/etc/deniz-cloud/posix-api-broker.credentials
witness_name=.denizcloud-mount-witness
critical=/run/deniz-cloud/posix-storage-critical.json
firewall_table=deniz_cloud_storage
firewall_comment=deniz-cloud-posix-storage-v1
namespace_unit=deniz-cloud-storage-namespace.service
metadata_unit=deniz-cloud-storage-metadata.service
smb_unit=deniz-cloud-storage-smb.service
broker_unit=deniz-cloud-storage-api-broker.service

assert_config_file() {
  [[ -f "$config" && ! -L "$config" ]] || { echo "Missing safe config: $config" >&2; return 1; }
  [[ "$(stat -c '%u:%g' "$config")" == 0:0 ]] || { echo "Config must be root:root" >&2; return 1; }
  (( (8#$(stat -c '%a' "$config") & 8#022) == 0 )) || { echo "Config must not be group/other writable" >&2; return 1; }
}

load_config() {
  assert_config_file
  # The file is privileged operator configuration and is rejected when it is
  # a symlink or writable by non-root users.
  set -a
  # shellcheck disable=SC1090
  source "$config"
  set +a
  # Each role names its member mountpoints and the filesystem UUID of each, in
  # the same order. A single-disk role names its own mountpoint and one UUID; a
  # pooled role names the members underneath its mergerfs mount. The plural
  # spelling is what lets the hdd role span more than one physical disk.
  : "${DENIZ_POSIX_SSD_UUIDS:?required}"
  : "${DENIZ_POSIX_HDD_UUIDS:?required}"
  : "${DENIZ_POSIX_SSD_MEMBERS:?required}"
  : "${DENIZ_POSIX_HDD_MEMBERS:?required}"
  : "${DENIZ_POSIX_SSD_BRANCH_ID:?required}"
  : "${DENIZ_POSIX_HDD_BRANCH_ID:?required}"
  : "${DENIZ_POSIX_TAILSCALE_IP:?required}"
  : "${DENIZ_POSIX_SSD_RESERVE:?required}"
  : "${DENIZ_POSIX_BOUNDARY_MODE:?required}"
  : "${STORAGE_NAMESPACE_WITNESS_PATH:?required}"
  : "${STORAGE_NAMESPACE_WITNESS_VALUE:?required}"
  : "${DENIZ_POSIX_COMPOSE_FILE:?required}"
  : "${DENIZ_POSIX_COMPOSE_OVERRIDE:?required}"
  : "${DENIZ_POSIX_COMPOSE_ENV:?required}"
  for uuid in ${DENIZ_POSIX_SSD_UUIDS//,/ } ${DENIZ_POSIX_HDD_UUIDS//,/ } "$DENIZ_POSIX_SSD_BRANCH_ID" "$DENIZ_POSIX_HDD_BRANCH_ID"; do
    [[ "$uuid" =~ ^[0-9A-Fa-f-]{8,64}$ ]] || { echo "Invalid UUID-shaped config value" >&2; return 1; }
  done
  # Members and UUIDs are positional, so a length mismatch means validation
  # would silently check fewer disks than are actually carrying data.
  local -a _members _uuids
  local role_upper
  for role_upper in SSD HDD; do
    local members_var="DENIZ_POSIX_${role_upper}_MEMBERS" uuids_var="DENIZ_POSIX_${role_upper}_UUIDS"
    IFS=: read -ra _members <<< "${!members_var}"
    IFS=, read -ra _uuids <<< "${!uuids_var}"
    (( ${#_members[@]} > 0 && ${#_members[@]} == ${#_uuids[@]} )) \
      || { echo "$role_upper member and UUID lists must be non-empty and the same length" >&2; return 1; }
  done
  [[ "$DENIZ_POSIX_SSD_BRANCH_ID" != "$DENIZ_POSIX_HDD_BRANCH_ID" ]] || { echo "Branch IDs must be distinct" >&2; return 1; }
  IFS=. read -r tail_a tail_b tail_c tail_d <<< "$DENIZ_POSIX_TAILSCALE_IP"
  [[ "$tail_a" == 100 && "$tail_b" =~ ^[0-9]+$ && "$tail_c" =~ ^[0-9]+$ && "$tail_d" =~ ^[0-9]+$ ]] || { echo "Tailscale IPv4 must be in 100.64.0.0/10" >&2; return 1; }
  (( tail_b >= 64 && tail_b <= 127 && tail_c <= 255 && tail_d <= 255 )) || { echo "Tailscale IPv4 must be in 100.64.0.0/10" >&2; return 1; }
  [[ "$DENIZ_POSIX_BOUNDARY_MODE" == gate1b-pilot ]] || { echo "Only the non-production Gate1B broker pilot is currently permitted" >&2; return 1; }
  [[ "$DENIZ_POSIX_SSD_RESERVE" =~ ^[1-9][0-9]*(M|G|T)$ ]] || { echo "Reserve must use M, G, or T units" >&2; return 1; }
  [[ "$STORAGE_NAMESPACE_WITNESS_PATH" == "/data/storage/$witness_name" ]] || { echo "Broker witness path must match the container contract" >&2; return 1; }
  [[ "$STORAGE_NAMESPACE_WITNESS_VALUE" =~ ^[A-Za-z0-9._:-]{16,200}$ ]] || { echo "Invalid broker witness value" >&2; return 1; }
  [[ "$DENIZ_POSIX_COMPOSE_FILE" == /* && "$DENIZ_POSIX_COMPOSE_OVERRIDE" == /* && "$DENIZ_POSIX_COMPOSE_ENV" == /* ]] || { echo "Compose paths must be absolute" >&2; return 1; }
}

# Sorted, comma-joined set of the filesystem UUIDs actually backing a role,
# read from the member mounts themselves. Sorting makes the comparison against
# the configured set a plain string compare.
observed_member_uuids() {
  local members=$1 member src uuid
  local -a member_arr out=()
  IFS=: read -ra member_arr <<< "$members"
  for member in "${member_arr[@]}"; do
    mountpoint -q "$member" || { echo "member is not mounted: $member" >&2; return 1; }
    src=$(findmnt -n -o SOURCE --target "$member") || return 1
    uuid=$(blkid -s UUID -o value "$src" 2>/dev/null) || true
    [[ -n "$uuid" ]] || { echo "member has no filesystem UUID: $member" >&2; return 1; }
    out+=("${uuid,,}")
  done
  printf '%s\n' "${out[@]}" | sort | paste -sd, -
}

# A pooled role must be serving every configured member and nothing else.
#
# This is the check that makes pooling safe. mergerfs does not fail when one of
# its branches disappears — it silently serves the remaining subset, so every
# file on the absent disk simply stops existing. Downstream that is
# indistinguishable from a mass deletion, and the "tier root is non-empty"
# guard that protects a single-disk tier does not fire, because the surviving
# member keeps the root populated. The watchdog calls this on every tick, which
# is what turns a dropped member into a withdrawn namespace instead.
validate_pool_membership() {
  local mount_path=$1 members=$2 role=$3 runtime expected
  [[ "$(findmnt -n -o FSTYPE --target "$mount_path")" == fuse.mergerfs ]] \
    || { echo "$role pool is not a mergerfs mount" >&2; return 1; }
  # The runtime config lives on the .mergerfs pseudo-file inside the mount, not
  # on the mount root, and each branch carries a =RW / =RO mode suffix.
  runtime=$(getfattr --only-values -n user.mergerfs.branches "$mount_path/.mergerfs" 2>/dev/null \
            | tr ':' '\n' | sed 's/=.*$//' | sed '/^$/d' | sort | paste -sd: -) \
    || { echo "$role pool branch list is unreadable" >&2; return 1; }
  [[ -n "$runtime" ]] || { echo "$role pool reported no branches" >&2; return 1; }
  expected=$(printf '%s\n' "${members//:/$'\n'}" | sort | paste -sd: -)
  [[ "$runtime" == "$expected" ]] \
    || { echo "$role pool membership drift: serving [$runtime] want [$expected]" >&2; return 1; }
}

validate_branch() {
  local mount_path=$1 branch_path=$2 role=$3 expected_uuids=$4 expected_id=$5 members=$6
  local marker actual_uuids expected_sorted
  mountpoint -q "$mount_path" || { echo "$role filesystem is not mounted" >&2; return 1; }
  # More than one member means the role is pooled; assert the pool is whole
  # before anything is trusted to be a complete view of it.
  if [[ "$members" == *:* ]]; then
    validate_pool_membership "$mount_path" "$members" "$role" || return 1
  fi
  actual_uuids=$(observed_member_uuids "$members") || { echo "$role member enumeration failed" >&2; return 1; }
  expected_sorted=$(printf '%s\n' "${expected_uuids//,/$'\n'}" | tr 'A-Z' 'a-z' | sort | paste -sd, -)
  [[ "$actual_uuids" == "$expected_sorted" ]] \
    || { echo "$role filesystem UUID mismatch: have [$actual_uuids] want [$expected_sorted]" >&2; return 1; }
  [[ -d "$branch_path" && ! -L "$branch_path" ]] || { echo "$role namespace branch is missing or unsafe" >&2; return 1; }
  [[ "$(findmnt -n -o TARGET --target "$branch_path")" == "$mount_path" ]] || { echo "$role branch crossed an unexpected mount" >&2; return 1; }
  marker="$branch_path/.denizcloud-branch.json"
  [[ -f "$marker" && ! -L "$marker" ]] || { echo "$role branch marker is missing or unsafe" >&2; return 1; }
  jq -e --arg role "$role" --arg uuids "$expected_sorted" --arg id "$expected_id" '
    .schemaVersion == 2 and .role == $role and
    ((.filesystemUuids | map(ascii_downcase) | sort | join(",")) == $uuids) and
    .branchId == $id and (.createdAt | type == "string")
  ' "$marker" >/dev/null || { echo "$role branch marker mismatch" >&2; return 1; }
  [[ ! -e "$branch_path/.s3-v2" && ! -L "$branch_path/.s3-v2" ]] || { echo "S3 storage must remain outside the POSIX namespace" >&2; return 1; }
}

validate_branches() {
  load_config
  validate_branch "$ssd_mount" "$ssd_branch" ssd "$DENIZ_POSIX_SSD_UUIDS" "$DENIZ_POSIX_SSD_BRANCH_ID" "$DENIZ_POSIX_SSD_MEMBERS"
  validate_branch "$hdd_mount" "$hdd_branch" hdd "$DENIZ_POSIX_HDD_UUIDS" "$DENIZ_POSIX_HDD_BRANCH_ID" "$DENIZ_POSIX_HDD_MEMBERS"
}

validate_samba_principals() {
  local broker_username
  # Validate the numeric identity, not a username's primary group.
  #
  # Every production storage file is owned 1000:1000, but on this host gid 1000
  # is `gpio` (a Pi system group) and the storage user's *primary* group is a
  # different gid entirely. Checking `getent passwd <user>` for 1000:1000 would
  # fail on a correctly configured machine, and forcing files to the user's
  # primary group would write a gid no existing file uses.
  [[ -n "$(getent passwd "$storage_uid")" ]] || { echo "No user with uid ${storage_uid}" >&2; return 1; }
  [[ -n "$(getent group "$storage_gid")" ]] || { echo "No group with gid ${storage_gid}" >&2; return 1; }
  local owner
  owner="$(stat -c '%u:%g' "$ssd_branch")"
  [[ "$owner" == "${storage_uid}:${storage_gid}" ]] || {
    echo "Namespace branch is ${owner}, expected ${storage_uid}:${storage_gid}" >&2
    return 1
  }
  getent passwd deniz-api-broker >/dev/null || { echo "Missing non-login Unix principal: deniz-api-broker" >&2; return 1; }
  [[ "$(getent passwd deniz-api-broker | cut -d: -f7)" =~ /(nologin|false)$ ]] || { echo "API broker Unix principal must be non-login" >&2; return 1; }
  pdbedit -L -u deniz-api-broker >/dev/null 2>&1 || { echo "Missing Samba principal: deniz-api-broker" >&2; return 1; }
  [[ -f "$credentials" && ! -L "$credentials" && "$(stat -c '%u:%g:%a' "$credentials")" == 0:0:600 ]] || { echo "Unsafe API broker credentials" >&2; return 1; }
  broker_username=$(awk -F= '$1=="username"{print $2}' "$credentials")
  [[ "$broker_username" == deniz-api-broker ]] || { echo "API broker credentials name mismatch" >&2; return 1; }
}

validate_runtime() {
  validate_branches
  validate_samba_principals
  # Asserted here rather than in compose validation: by the time `validate`
  # runs the metadata service is up, and Docker must find a socket — not a
  # missing path it would replace with a directory.
  [[ -S "$metadata_socket" ]] || {
    echo "Metadata socket is absent or not a socket: ${metadata_socket}" >&2
    return 1
  }
}

validate_compose() {
  local rendered
  load_config
  # Owned by root or by whoever owns the deploy directory, and not writable by
  # anyone else. CI extracts these over SSH as the deploy user, so demanding
  # root:root would fail every deploy until someone remembered to chown — a
  # step that gets forgotten and then gets "fixed" by disabling the check.
  local deploy_owner
  deploy_owner="$(stat -c '%u' "$(dirname "$DENIZ_POSIX_COMPOSE_FILE")")"
  for compose_input in "$DENIZ_POSIX_COMPOSE_FILE" "$DENIZ_POSIX_COMPOSE_OVERRIDE" "$DENIZ_POSIX_COMPOSE_ENV"; do
    [[ -f "$compose_input" && ! -L "$compose_input" ]] || { echo "Missing safe Compose input: $compose_input" >&2; return 1; }
    local input_owner
    input_owner="$(stat -c '%u' "$compose_input")"
    [[ "$input_owner" == 0 || "$input_owner" == "$deploy_owner" ]] || {
      echo "Compose input is owned by uid ${input_owner}, not root or the deploy user: $compose_input" >&2
      return 1
    }
    (( (8#$(stat -c '%a' "$compose_input") & 8#022) == 0 )) || { echo "Compose input is group/other writable: $compose_input" >&2; return 1; }
  done
  [[ "$(stat -c '%a' "$DENIZ_POSIX_COMPOSE_ENV")" == 600 ]] || { echo "Compose environment must be mode 0600" >&2; return 1; }
  rendered=$(docker compose --env-file "$DENIZ_POSIX_COMPOSE_ENV" -f "$DENIZ_POSIX_COMPOSE_FILE" -f "$DENIZ_POSIX_COMPOSE_OVERRIDE" config --format json)
  jq -e --arg witness "$STORAGE_NAMESPACE_WITNESS_VALUE" '
    .services.api.environment.STORAGE_NAMESPACE_MODE == "broker-mounted" and
    .services.api.environment.STORAGE_NAMESPACE_PATH == "/data/storage" and
    .services.api.environment.STORAGE_NAMESPACE_WITNESS_PATH == "/data/storage/.denizcloud-mount-witness" and
    .services.api.environment.STORAGE_NAMESPACE_WITNESS_VALUE == $witness and
    .services.api.environment.STORAGE_METADATA_SOCKET == "/run/deniz-cloud/storage-metadata.sock" and
    (.services.api.environment.STORAGE_METADATA_TOKEN | type == "string" and length >= 16)
  ' <<< "$rendered" >/dev/null || { echo "Rendered API broker environment mismatch" >&2; return 1; }
  jq -e '
    def volumes: (.services.api.volumes // []);
    # Compose renders a writable bind as read_only:null, not false, so this
    # asserts "not read-only" rather than an exact false.
    ([volumes[] | select(.type == "bind" and .source == "/srv/deniz-cloud/api-storage" and .target == "/data/storage" and (.read_only != true))] | length) == 1 and
    ([volumes[] | select(.type == "bind")] | length) == 12 and
    ([volumes[] | select(.type == "bind") | .target] | unique | length) == 12 and
    ([volumes[] | select(.type == "bind") | select(
      (.source == "/srv/deniz-cloud/api-storage" and .target == "/data/storage") or
      (.source == "/run/deniz-cloud" and .target == "/run/deniz-cloud") or
      (.source == "/mnt/ssd/deniz-cloud/internal/.capacity" and .target == "/data/capacity/ssd" and .read_only == true) or
      (.source == "/mnt/hdd/deniz-cloud/internal/.capacity" and .target == "/data/capacity/hdd" and .read_only == true) or
      (.source == "/srv/deniz-cloud/internal/.capacity" and .target == "/data/capacity/root" and .read_only == true) or
      # Per-member capacity, read-only. A pooled tier makes df report the
      # mergerfs mount instead of a block device, so the sampler cannot resolve
      # a physical disk without these.
      (.source == "/mnt/hdd-disks/d1/deniz-cloud/internal/.capacity" and .target == "/data/capacity/hdd-d1" and .read_only == true) or
      (.source == "/mnt/hdd-disks/d2/deniz-cloud/internal/.capacity" and .target == "/data/capacity/hdd-d2" and .read_only == true) or
      # One mount with subdirectories, not four mounts. S3 publishes by renaming
      # the temp path onto the final path, and rename() across two binds is
      # EXDEV even on the same disk, so the split layout failed every upload
      # (a323062). The boundary this check defends is the namespace one: the API
      # still reaches projected storage only through the broker bind above, and
      # internal/ sits deliberately outside the namespace as API-private state.
      (.source == "/mnt/ssd/deniz-cloud/internal" and .target == "/data/internal") or
      (.source == "/proc" and .target == "/host/proc" and .read_only == true) or
      (.source == "/sys" and .target == "/host/sys" and .read_only == true) or
      (.source == "/mnt/hdd/backups" and .target == "/backups") or
      (.source == "/var/lib/deniz-cloud" and .target == "/host-control")
    )] | length) == ([volumes[] | select(.type == "bind")] | length)
  ' <<< "$rendered" >/dev/null || { echo "Rendered API volumes bypass the broker or expose a broad/private storage root" >&2; return 1; }
  local bind_source canonical_source
  while IFS= read -r bind_source; do
    # The metadata socket is created at runtime by a later unit, so it cannot
    # exist when compose is validated at namespace-mount time. Requiring it
    # here is a dependency cycle: namespace -> compose-validate -> socket ->
    # metadata -> namespace. Its presence is asserted by `validate` instead,
    # which runs after the metadata service is up.
    [[ "$bind_source" != "$(dirname "$metadata_socket")" ]] || continue
    canonical_source=$(realpath -e "$bind_source" 2>/dev/null || true)
    [[ "$canonical_source" == "$bind_source" ]] || { echo "API bind source is absent or aliases another path: $bind_source" >&2; return 1; }
  done < <(jq -r '.services.api.volumes[] | select(.type == "bind") | .source' <<< "$rendered")
}

# Stamps the identity an account root has to carry to be projectable.
#
# This happens here because it cannot happen anywhere else: identity lives in
# the security xattr namespace, which only root may write, and the API reaches
# storage through the unprivileged broker. An unstamped root is also not
# something adoption can rescue — its only ancestor is the namespace root,
# which is deliberately ownerless — so the projector records NO_IDENTITY
# against it on every scan, never walks into it, and holds the whole projection
# dirty while the account it belongs to stays invisible.
stamp_account_identity() {
  local target=$1 owner=$2
  setfattr -n security.denizcloud.schema_version -v 1 "$target"
  setfattr -n security.denizcloud.id -v "$(cat /proc/sys/kernel/random/uuid)" "$target"
  setfattr -n security.denizcloud.owner_id -v "$owner" "$target"
  setfattr -n security.denizcloud.created_at -v "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$target"
}

provision_account() {
  load_config
  [[ "$account_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] || { echo "A canonical lowercase account UUID is required" >&2; return 1; }
  merged_is_current && validate_witness || { echo "Authoritative namespace is unavailable" >&2; return 1; }
  # Frozen API paths place each account UUID directly below the namespace
  # root. Device principals must use this exact path as their Unix home so
  # Samba Personal and the API broker resolve the same tree.
  local account_root="$merged/$account_id"
  if [[ -e "$account_root" || -L "$account_root" ]]; then
    [[ -d "$account_root" && ! -L "$account_root" && "$(stat -c '%u:%g:%a' "$account_root")" == "${storage_uid}:${storage_gid}:770" ]] || { echo "Existing account root is unsafe" >&2; return 1; }
    # An existing root is reported, never stamped. A root that predates this
    # stamping usually already has a projected folder row, and its id is what
    # share links are keyed on — but that id lives in Postgres, which this
    # script has no access to. Minting a fresh one here would displace the row
    # rather than adopt it, so the repair is left to an operator who can read
    # the projected id and set it explicitly.
    [[ -n "$(getfattr --only-values -n security.denizcloud.id "$account_root" 2>/dev/null)" ]] \
      || echo "Account root $account_root carries no identity; stamp it with the projected folder id" >&2
    return
  fi
  install -d -m 0770 -o "$storage_uid" -g "$storage_gid" "$account_root"
  stamp_account_identity "$account_root" "$account_id"
  sync -f "$merged"
}

merged_is_current() {
  [[ "$(findmnt -n -o FSTYPE --target "$merged" 2>/dev/null || true)" == fuse.mergerfs ]] &&
    [[ "$(findmnt -n -o SOURCE --target "$merged" 2>/dev/null || true)" == deniz-cloud-storage ]]
}

validate_witness() {
  local path="$merged/$witness_name"
  [[ -f "$path" && ! -L "$path" && "$(stat -c '%u:%g:%a:%h' "$path")" == 0:0:444:1 ]] || return 1
  [[ "$(cat "$path")" == "$STORAGE_NAMESPACE_WITNESS_VALUE" ]] || return 1
}

publish_witness() {
  local path="$merged/$witness_name" partial="$merged/.witness.partial.$$"
  if [[ -e "$path" || -L "$path" ]]; then
    validate_witness || { echo "Existing broker witness is invalid" >&2; return 1; }
    return
  fi
  # Not an ownership assertion on the merged root: once mergerfs is mounted the
  # root reflects the *branches*, which are owned by the storage identity, not
  # root. What matters is that it is a directory no one outside the storage
  # group can write, and that the witness itself is root-owned and read-only.
  local merged_mode
  merged_mode="$(stat -c '%a' "$merged")"
  (( (8#$merged_mode & 8#002) == 0 )) || { echo "Merged root is world-writable" >&2; return 1; }
  printf '%s\n' "$STORAGE_NAMESPACE_WITNESS_VALUE" > "$partial"
  chown 0:0 "$partial"; chmod 0444 "$partial"; sync -f "$partial"; mv "$partial" "$path"; sync -f "$merged"
  validate_witness
}

mount_namespace() {
  validate_branches
  [[ ! -e "$critical" && ! -L "$critical" ]] || { echo "Critical marker exists; run recover after repairing branches" >&2; return 1; }
  if mountpoint -q "$merged"; then merged_is_current || { echo "Merged path has a foreign mount" >&2; return 1; }; publish_witness; return; fi
  install -d -m 0755 -o root -g root "$merged" "$internal" "$broker_mount"
  [[ -z "$(find "$merged" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "Unmounted merged path is not empty" >&2; return 1; }
  [[ "$(mergerfs --version | awk 'NR==1{sub(/^v/,"",$NF);print $NF}')" == 2.42.0 ]] || { echo "mergerfs 2.42.0 is required" >&2; return 1; }
  mergerfs -o "allow_other,nodev,nosuid,branches-mount-timeout=5,branches-mount-timeout-fail=true,minfreespace=$DENIZ_POSIX_SSD_RESERVE,moveonenospc=false,inodecalc=path-hash,xattr=passthrough,posix-acl=true,kernel-permissions-check=true,cache.files=off,cache.attr=0,cache.entry=0,cache.negative-entry=0,cache.readdir=false,cache.statfs=0,cache.writeback=false,follow-symlinks=never,category.create=ff,category.search=ff,category.action=epall,func.getattr=ff,fsname=deniz-cloud-storage" "$ssd_branch:$hdd_branch" "$merged"
  if ! merged_is_current || ! publish_witness; then
    fusermount3 -u "$merged" || umount "$merged" || true
    echo "Merged mount verification failed and was rolled back" >&2
    return 1
  fi
}

broker_is_current() {
  [[ "$(findmnt -n -o FSTYPE --target "$broker_mount" 2>/dev/null || true)" == cifs ]] &&
    [[ "$(findmnt -n -o SOURCE --target "$broker_mount" 2>/dev/null || true)" == //127.0.0.1/ApiBroker ]]
}

mount_broker() {
  load_config
  merged_is_current || { echo "Merged namespace is not mounted" >&2; return 1; }
  validate_witness || { echo "Merged namespace witness is invalid" >&2; return 1; }
  [[ -f "$credentials" && ! -L "$credentials" && "$(stat -c '%u:%g:%a' "$credentials")" == 0:0:600 ]] || { echo "Unsafe API broker credentials" >&2; return 1; }
  if mountpoint -q "$broker_mount"; then broker_is_current || { echo "Broker path has a foreign mount" >&2; return 1; }; return; fi
  install -d -m 0755 -o root -g root "$broker_mount"
  [[ -z "$(find "$broker_mount" -mindepth 1 -maxdepth 1 -print -quit)" ]] || { echo "Unmounted broker path is not empty" >&2; return 1; }
  mount -t cifs //127.0.0.1/ApiBroker "$broker_mount" -o "credentials=$credentials,vers=3.1.1,seal,sign,uid=1000,gid=1000,forceuid,forcegid,nosuid,nodev,noexec,noperm,nounix,cache=none,actimeo=0,serverino"
  if ! broker_is_current || [[ "$(cat "$broker_mount/$witness_name" 2>/dev/null || true)" != "$STORAGE_NAMESPACE_WITNESS_VALUE" ]]; then
    broker_is_current && umount "$broker_mount" || true
    echo "API broker verification failed and was rolled back" >&2
    return 1
  fi
}

firewall_current() {
  local ruleset
  ruleset=$(nft -j list table inet "$firewall_table" 2>/dev/null || true)
  [[ -n "$ruleset" ]] && jq -e \
    --arg table "$firewall_table" \
    --arg tableComment "$firewall_comment" '
      def rules: [.nftables[] | .rule? | select(.family == "inet" and .table == $table and .chain == "input")];
      def chains: [.nftables[] | .chain? | select(.family == "inet" and .table == $table)];
      def tcp445: .match.op == "==" and .match.left.payload.protocol == "tcp" and .match.left.payload.field == "dport" and .match.right == 445;
      def iif($name): .match.op == "==" and .match.left.meta.key == "iifname" and .match.right == $name;
      def ipv4($address): .match.op == "==" and .match.left.payload.protocol == "ip" and .match.left.payload.field == "daddr" and .match.right == $address;
      ([.nftables[] | .table? | select(.family == "inet" and .name == $table and .comment == $tableComment)] | length) == 1 and
      (chains | length) == 1 and
      (chains[0].name == "input" and chains[0].type == "filter" and chains[0].hook == "input" and chains[0].prio == -100 and chains[0].policy == "accept") and
      (rules | length) == 3 and
      (rules[0].comment == "API broker loopback" and (rules[0].expr | length) == 4 and (rules[0].expr[0] | iif("lo")) and (rules[0].expr[1] | ipv4("127.0.0.1")) and (rules[0].expr[2] | tcp445) and (rules[0].expr[3] | has("accept") and .accept == null)) and
      (rules[1].comment == "Tailnet SMB clients" and (rules[1].expr | length) == 3 and (rules[1].expr[0] | iif("tailscale0")) and (rules[1].expr[1] | tcp445) and (rules[1].expr[2] | has("accept") and .accept == null)) and
      (rules[2].comment == "Reject all other SMB" and (rules[2].expr | length) == 2 and (rules[2].expr[0] | tcp445) and rules[2].expr[1].reject.type == "tcp reset")
    ' <<< "$ruleset" >/dev/null
}

start_firewall() {
  load_config
  [[ "$(ip -4 -o address show dev tailscale0 | awk 'NR==1{split($4,a,"/");print a[1]}')" == "$DENIZ_POSIX_TAILSCALE_IP" ]] || { echo "Configured Tailscale IP is not present on tailscale0" >&2; return 1; }
  ! ss -H -ltn 'sport = :445' | grep -q . || { echo "Refusing to protect an existing TCP 445 listener" >&2; return 1; }
  for stock_unit in smbd.service nmbd.service samba-ad-dc.service; do
    ! systemctl is-active --quiet "$stock_unit" || { echo "Stock Samba unit is active: $stock_unit" >&2; return 1; }
  done
  if nft list table inet "$firewall_table" >/dev/null 2>&1; then
    if firewall_current; then return; fi
    # The table carries this boundary's comment, so it is ours to replace —
    # an older rule shape from a previous version, not a foreign table.
    if nft -j list table inet "$firewall_table" 2>/dev/null \
      | jq -e --arg c "$firewall_comment" '[.nftables[] | .table? | select(.comment == $c)] | length == 1' >/dev/null; then
      nft delete table inet "$firewall_table"
    else
      echo "Foreign firewall table exists" >&2
      return 1
    fi
  fi
  nft -f - <<EOF
add table inet $firewall_table { comment "$firewall_comment"; }
add chain inet $firewall_table input { type filter hook input priority -100; policy accept; }
add rule inet $firewall_table input iifname "lo" ip daddr 127.0.0.1 tcp dport 445 accept comment "API broker loopback"
add rule inet $firewall_table input iifname "tailscale0" tcp dport 445 accept comment "Tailnet SMB clients"
add rule inet $firewall_table input tcp dport 445 reject with tcp reset comment "Reject all other SMB"
EOF
  firewall_current || { nft delete table inet "$firewall_table" || true; echo "Firewall verification failed" >&2; return 1; }
}

stop_firewall() {
  load_config
  nft list table inet "$firewall_table" >/dev/null 2>&1 || return 0
  firewall_current || { echo "Refusing to remove foreign firewall table" >&2; return 1; }
  ! ss -H -ltn 'sport = :445' | grep -q . || { echo "Refusing to remove firewall while TCP 445 listens" >&2; return 1; }
  nft delete table inet "$firewall_table"
}

fail_closed() {
  local reason=$1
  install -d -m 0755 /run/deniz-cloud
  jq -n --arg at "$(date --utc +%FT%TZ)" --arg reason "$reason" '{schemaVersion:1,at:$at,reason:$reason,writesWithdrawn:true}' > "$critical.partial"
  mv "$critical.partial" "$critical"; chmod 0444 "$critical"
  systemctl stop "$metadata_unit" || true
  systemctl stop "$broker_unit" || true
  systemctl stop "$smb_unit" || true
  # A failed unmount and a foreign mount are different problems: the first
  # needs a retry or a lazy unmount, the second must never be touched. Folding
  # them into one message hides which one happened.
  if mountpoint -q "$broker_mount"; then
    if broker_is_current; then
      umount "$broker_mount" || echo "Broker unmount failed during fail-close" >&2
    else
      echo "Preserving foreign broker mount during fail-close" >&2
    fi
  fi
  if mountpoint -q "$merged"; then
    if merged_is_current; then
      fusermount3 -u "$merged" || umount "$merged" \
        || echo "Merged unmount failed during fail-close" >&2
    else
      echo "Preserving foreign merged mount during fail-close" >&2
    fi
  fi
  # The namespace unit is oneshot+RemainAfterExit, so unmounting behind
  # systemd's back leaves it reporting active while nothing is mounted — and a
  # later `start` is then a no-op that silently does nothing. Stopping it makes
  # systemd's state match reality so recovery actually remounts.
  systemctl stop "$namespace_unit" || true
  echo "STOP: POSIX namespace withdrawn: $reason" >&2
  return 20
}

watch_once() {
  validate_branches || fail_closed branch-validation
  merged_is_current || fail_closed merged-mount
  validate_witness || fail_closed broker-witness
  broker_is_current || fail_closed api-broker-mount
  [[ "$(cat "$broker_mount/$witness_name" 2>/dev/null || true)" == "$STORAGE_NAMESPACE_WITNESS_VALUE" ]] || fail_closed api-broker-witness
  systemctl is-active --quiet "$metadata_unit" || fail_closed metadata-service
  systemctl is-active --quiet "$smb_unit" || fail_closed smbd-service
  local smbd_pid
  smbd_pid=$(systemctl show -p MainPID --value "$smb_unit")
  [[ "$smbd_pid" =~ ^[1-9][0-9]*$ && -r "/proc/$smbd_pid/comm" && "$(cat "/proc/$smbd_pid/comm")" == smbd ]] || fail_closed smbd-process
  ss -H -ltnp 'sport = :445' | grep -Fq "pid=$smbd_pid," || fail_closed smbd-listener
  firewall_current || fail_closed smb-firewall
}

status_json() {
  load_config
  jq -n --argjson ssd "$(validate_branch "$ssd_mount" "$ssd_branch" ssd "$DENIZ_POSIX_SSD_UUIDS" "$DENIZ_POSIX_SSD_BRANCH_ID" "$DENIZ_POSIX_SSD_MEMBERS" >/dev/null 2>&1 && echo true || echo false)" \
    --argjson hdd "$(validate_branch "$hdd_mount" "$hdd_branch" hdd "$DENIZ_POSIX_HDD_UUIDS" "$DENIZ_POSIX_HDD_BRANCH_ID" "$DENIZ_POSIX_HDD_MEMBERS" >/dev/null 2>&1 && echo true || echo false)" \
    --arg hddMembers "$DENIZ_POSIX_HDD_MEMBERS" \
    --argjson merged "$(merged_is_current && echo true || echo false)" --argjson broker "$(broker_is_current && echo true || echo false)" \
    --argjson firewall "$(firewall_current && echo true || echo false)" --argjson critical "$([[ -e "$critical" || -L "$critical" ]] && echo true || echo false)" \
    --arg witnessPath "/data/storage/$witness_name" '{ssdValid:$ssd,hddValid:$hdd,hddMembers:($hddMembers|split(":")),mergedMounted:$merged,apiBrokerMounted:$broker,firewallCurrent:$firewall,critical:$critical,containerWitnessPath:$witnessPath,s3Included:false}'
}

if [[ "$mode" == --dry-run ]]; then
  jq -n --arg mode "$mode" --arg action "$action" --arg ssd "$ssd_branch" --arg hdd "$hdd_branch" --arg merged "$merged" --arg broker "$broker_mount" --arg witness "/data/storage/$witness_name" '{mode:$mode,action:$action,writes:false,paths:{ssd:$ssd,hdd:$hdd,merged:$merged,apiBroker:$broker},containerWitnessPath:$witness,s3Included:false}'
  exit 0
fi

(( EUID == 0 )) || { echo "Execute mode requires root" >&2; exit 1; }
for command in blkid docker find findmnt fusermount3 getent getfattr ip jq mergerfs mount mountpoint nft paste pdbedit realpath setfattr smbstatus sort ss stat systemctl umount; do command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }; done

case "$action" in
  validate) validate_runtime; validate_compose; jq -n '{valid:true,boundaryMode:"gate1b-pilot",humanSharesAvailable:false,externalTcp445Allowed:false,s3Included:false}' ;;
  compose-validate) validate_compose; jq -n '{composeValid:true,brokerSource:"/srv/deniz-cloud/api-storage",containerTarget:"/data/storage"}' ;;
  mount) mount_namespace; jq -n --arg witness "$merged/$witness_name" '{mounted:true,witness:$witness}' ;;
  unmount) mountpoint -q "$broker_mount" && { echo "API broker must be unmounted first" >&2; exit 1; }; if mountpoint -q "$merged"; then merged_is_current || { echo "Refusing to unmount a foreign merged mount" >&2; exit 1; }; fusermount3 -u "$merged"; fi ;;
  firewall-start) start_firewall ;;
  firewall-stop) stop_firewall ;;
  broker-mount) mount_broker ;;
  broker-unmount) if mountpoint -q "$broker_mount"; then broker_is_current || { echo "Refusing to unmount a foreign broker mount" >&2; exit 1; }; umount "$broker_mount"; fi ;;
  provision-account) provision_account; jq -n --arg accountId "$account_id" '{provisioned:true,accountId:$accountId}' ;;
  watch) while true; do watch_once; sleep 2; done ;;
  recover) validate_branches; [[ ! -L "$critical" ]] || { echo "Unsafe critical marker" >&2; exit 1; }; rm -f "$critical"; echo '{"recovered":true}' ;;
  status) status_json ;;
esac
