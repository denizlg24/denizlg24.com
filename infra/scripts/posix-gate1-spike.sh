#!/bin/bash

set -euo pipefail

umask 077

mode="--dry-run"
mode_set=false
action="status"
action_set=false

usage() {
  echo "Usage: $0 [--dry-run|--execute] [prepare|start-samba|status|host-test|api-test|watchdog|branch-loss-test|reboot-check|stop|destroy]" >&2
}

for argument in "$@"; do
  case "$argument" in
    --dry-run|--execute)
      if [[ "$mode_set" == "true" ]]; then
        usage
        exit 2
      fi
      mode="$argument"
      mode_set=true
      ;;
    prepare|start-samba|status|host-test|api-test|watchdog|branch-loss-test|reboot-check|stop|destroy)
      if [[ "$action_set" == "true" ]]; then
        usage
        exit 2
      fi
      action="$argument"
      action_set=true
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
template="${POSIX_GATE1_SMB_TEMPLATE:-${script_dir}/../samba/posix-gate1-smb.conf.in}"
probe_bundle="${POSIX_GATE1_PROBE_BUNDLE:-${script_dir}/../../apps/api/dist/posix-gate1-probe.js}"
slow_client_bundle="${POSIX_GATE1_SLOW_CLIENT_BUNDLE:-${script_dir}/../../apps/api/dist/posix-gate1-slow-client.js}"
state_root="${POSIX_GATE1_ROOT:-/var/lib/deniz-cloud/posix-gate1}"
if [[ "$state_root" != "/" ]]; then
  state_root="${state_root%/}"
fi
if [[ "$state_root" != /* || "$state_root" == *//* || "$state_root" == */./* || "$state_root" == */../* || "$state_root" == */. || "$state_root" == */.. ]]; then
  echo "Gate 1 root must be a normalized absolute path" >&2
  exit 1
fi

if [[ "$state_root" == "/" || ! "$(basename "$state_root")" =~ ^posix-gate1([._-][A-Za-z0-9_-]+)?$ ]]; then
  echo "Gate 1 root must be a specifically named absolute path ending in posix-gate1" >&2
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
  if [[ "$state_root" == "$protected_root" || "$state_root" == "$protected_root/"* || "$protected_root" == "$state_root/"* ]]; then
    echo "Gate 1 root overlaps a protected production path: ${protected_root}" >&2
    exit 1
  fi
done

state_file="$state_root/state.json"
root_marker="$state_root/.posix-gate1-root.json"
image_dir="$state_root/images"
ssd_image="$image_dir/ssd.ext4"
hdd_image="$image_dir/hdd.ext4"
mount_dir="$state_root/mounts"
ssd_mount="$mount_dir/ssd"
hdd_mount="$mount_dir/hdd"
merged_mount="$mount_dir/merged"
ssd_branch="$ssd_mount/namespace"
hdd_branch="$hdd_mount/namespace"
probe_root="$merged_mount/posix-gate1-disposable"
samba_root="$state_root/samba"
evidence_dir="$state_root/evidence"
firewall_table="deniz_cloud_gate1"
watchdog_timeout_seconds="${POSIX_GATE1_WATCHDOG_TIMEOUT_SECONDS:-10}"
if [[ ! "$watchdog_timeout_seconds" =~ ^[1-9][0-9]*$ ]] || (( watchdog_timeout_seconds > 30 )); then
  echo "Gate 1 watchdog timeout must be an integer from 1 to 30 seconds" >&2
  exit 1
fi

state_phase="absent"
spike_id=""
ssd_loop=""
hdd_loop=""
startup_pid=""
startup_pid_file=""
startup_config=""
startup_auth_file=""
startup_probe_pid=""
startup_probe_start_time=""

read_state() {
  if [[ ! -f "$state_file" || -L "$state_file" ]]; then
    echo "Gate 1 state is missing or unsafe: ${state_file}" >&2
    exit 1
  fi
  state_phase="$(jq -er '.phase' "$state_file")"
  spike_id="$(jq -er '.spikeId' "$state_file")"
  ssd_loop="$(jq -er '.loops.ssd' "$state_file")"
  hdd_loop="$(jq -er '.loops.hdd' "$state_file")"
  if [[ ! "$state_phase" =~ ^(prepared|starting|samba|quarantined|stopped)$ || ! "$spike_id" =~ ^[0-9a-f-]{36}$ || ! "$ssd_loop" =~ ^/dev/loop[0-9]+$ || ! "$hdd_loop" =~ ^/dev/loop[0-9]+$ ]]; then
    echo "Gate 1 state contains invalid lifecycle values" >&2
    exit 1
  fi
  if [[ "$(jq -er '.root' "$state_file")" != "$state_root" || "$(jq -er '.images.ssd' "$state_file")" != "$ssd_image" || "$(jq -er '.images.hdd' "$state_file")" != "$hdd_image" ]]; then
    echo "Gate 1 state paths do not match this invocation" >&2
    exit 1
  fi
  if [[ ! -f "$root_marker" || -L "$root_marker" || "$(jq -er '.spikeId' "$root_marker")" != "$spike_id" ]]; then
    echo "Gate 1 root marker is missing or mismatched" >&2
    exit 1
  fi
}

update_phase() {
  local next_phase="$1"
  jq --arg phase "$next_phase" '.phase=$phase' "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  state_phase="$next_phase"
}

mount_source_is() {
  local target="$1"
  local expected="$2"
  [[ "$(findmnt -n -o SOURCE --target "$target" 2>/dev/null || true)" == "$expected" ]]
}

loop_backing_is() {
  local loop="$1"
  local image="$2"
  [[ "$(losetup -n -O BACK-FILE "$loop" 2>/dev/null | sed 's/ (deleted)$//' || true)" == "$image" ]]
}

branch_marker_is() {
  local mount="$1"
  local role="$2"
  local marker="$mount/.denizcloud-gate1-branch.json"
  [[ -f "$marker" && ! -L "$marker" ]] \
    && [[ "$(jq -er '.spikeId' "$marker")" == "$spike_id" ]] \
    && [[ "$(jq -er '.role' "$marker")" == "$role" ]]
}

merged_mount_is_disposable() {
  [[ "$(findmnt -n -o FSTYPE --target "$merged_mount" 2>/dev/null || true)" == "fuse.mergerfs" ]] \
    && [[ "$(findmnt -n -o SOURCE --target "$merged_mount" 2>/dev/null || true)" == "deniz-cloud-gate1" ]]
}

mount_disposable_union() {
  timeout --kill-after=2s "$watchdog_timeout_seconds" mergerfs \
    -o allow_other,nodev,nosuid,branches-mount-timeout=5,branches-mount-timeout-fail=true,minfreespace=128M,moveonenospc=false,inodecalc=path-hash,xattr=passthrough,posix-acl=true,kernel-permissions-check=true,cache.files=off,cache.attr=0,cache.entry=0,cache.negative-entry=0,cache.readdir=false,cache.statfs=0,cache.writeback=false,follow-symlinks=never,category.create=ff,category.search=ff,category.action=epall,func.getattr=ff,fsname=deniz-cloud-gate1 \
    "$ssd_branch:$hdd_branch" "$merged_mount"
  mountpoint -q "$merged_mount" && merged_mount_is_disposable
}

tailscale_ip="$(ip -4 -o address show dev tailscale0 2>/dev/null | awk 'NR == 1 {split($4, address, "/"); print address[1]}' || true)"
current_phase="absent"
if [[ -f "$state_file" && ! -L "$state_file" ]]; then
  current_phase="$(jq -r '.phase // "invalid"' "$state_file" 2>/dev/null || printf invalid)"
fi

if [[ "$mode" == "--dry-run" ]]; then
  jq -n \
    --arg mode "$mode" \
    --arg action "$action" \
    --arg root "$state_root" \
    --arg phase "$current_phase" \
    --arg tailscaleIp "$tailscale_ip" \
    --arg template "$template" \
    --arg probeBundle "$probe_bundle" \
    --arg slowClientBundle "$slow_client_bundle" \
    --argjson watchdogTimeoutSeconds "$watchdog_timeout_seconds" \
    '{mode:$mode,action:$action,root:$root,currentPhase:$phase,tailscaleIp:(if $tailscaleIp=="" then null else $tailscaleIp end),sambaTemplate:$template,probeBundle:$probeBundle,slowClientBundle:$slowClientBundle,watchdogTimeoutSeconds:$watchdogTimeoutSeconds,willMountProductionBranches:false,gate1Passed:false,stopRequired:($action == "branch-loss-test" or $action == "reboot-check")}'
  exit 0
fi
if (( EUID != 0 )); then
  echo "Gate 1 lifecycle changes require root" >&2
  exit 1
fi
for command in awk basename cat chmod chown cut date dirname docker fallocate find findmnt getfacl getent getfattr grep ip jq kill losetup mergerfs mkdir mkfs.ext4 mount mountpoint mv nft openssl readlink realpath runuser sed setfacl setfattr sha256sum sleep smbclient smbd smbpasswd smbstatus ss stat sync tar testparm timeout touch tr truncate umount; do
  if ! command -v "$command" >/dev/null; then
    echo "Required Gate 1 command is missing: ${command}" >&2
    exit 1
  fi
done

prepare_spike() {
  if [[ -e "$state_root" || -L "$state_root" ]]; then
    echo "Refusing to replace existing Gate 1 root: ${state_root}" >&2
    exit 1
  fi
  if [[ "$tailscale_ip" == "" ]]; then
    echo "tailscale0 has no IPv4 address" >&2
    exit 1
  fi
  if [[ "$(mergerfs --version | awk 'NR == 1 {sub(/^v/, "", $NF); print $NF}')" != "2.42.0" ]]; then
    echo "Gate 1 requires mergerfs 2.42.0" >&2
    exit 1
  fi
  if ss -H -ltn 'sport = :445' | grep -q .; then
    echo "TCP 445 already has a listener" >&2
    exit 1
  fi
  if nft list table inet "$firewall_table" >/dev/null 2>&1; then
    echo "A Gate 1 firewall table already exists" >&2
    exit 1
  fi

  local parent spike_user
  parent="$(dirname "$state_root")"
  spike_user="$(getent passwd 1000 | cut -d: -f1)"
  if [[ ! "$spike_user" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
    echo "UID 1000 does not resolve to a safe disposable namespace owner" >&2
    exit 1
  fi
  mkdir -p "$parent"
  if [[ -L "$parent" || "$(realpath -e "$parent")/$(basename "$state_root")" != "$state_root" ]]; then
    echo "Gate 1 root parent is unsafe" >&2
    exit 1
  fi

  mkdir -m 700 "$state_root" "$image_dir" "$mount_dir" "$samba_root" "$evidence_dir"
  mkdir -m 700 "$ssd_mount" "$hdd_mount" "$merged_mount"
  # The authenticated UID 1000 test client invokes the fixed Docker peer
  # wrapper without passwordless sudo. Traversal alone exposes no directory
  # entries; every secret/evidence directory below remains mode 0700.
  chmod 711 "$state_root" "$mount_dir"
  spike_id="$(cat /proc/sys/kernel/random/uuid)"
  jq -n --arg spikeId "$spike_id" --arg root "$state_root" \
    '{schemaVersion:1,spikeId:$spikeId,root:$root}' > "$root_marker"
  chmod 600 "$root_marker"

  local prepared=false
  cleanup_failed_prepare() {
    set +e
    if [[ "$prepared" != "true" ]]; then
      mountpoint -q "$merged_mount" && umount "$merged_mount"
      mountpoint -q "$ssd_mount" && umount "$ssd_mount"
      mountpoint -q "$hdd_mount" && umount "$hdd_mount"
      [[ -n "$ssd_loop" ]] && loop_backing_is "$ssd_loop" "$ssd_image" && losetup -d "$ssd_loop"
      [[ -n "$hdd_loop" ]] && loop_backing_is "$hdd_loop" "$hdd_image" && losetup -d "$hdd_loop"
      if ! mountpoint -q "$merged_mount" \
        && ! mountpoint -q "$ssd_mount" \
        && ! mountpoint -q "$hdd_mount" \
        && { [[ -z "$ssd_loop" ]] || ! loop_backing_is "$ssd_loop" "$ssd_image"; } \
        && { [[ -z "$hdd_loop" ]] || ! loop_backing_is "$hdd_loop" "$hdd_image"; } \
        && [[ -f "$root_marker" ]] \
        && [[ "$(jq -r '.spikeId // ""' "$root_marker" 2>/dev/null)" == "$spike_id" ]]; then
        find "$state_root" -xdev -depth -delete
      else
        echo "Gate 1 prepare cleanup was incomplete; preserving ${state_root} for recovery" >&2
      fi
    fi
  }
  trap cleanup_failed_prepare EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  truncate -s 768M "$ssd_image"
  truncate -s 1536M "$hdd_image"
  mkfs.ext4 -q -F -m 0 -L dc-g1-ssd "$ssd_image"
  mkfs.ext4 -q -F -m 0 -L dc-g1-hdd "$hdd_image"
  ssd_loop="$(losetup --find --show "$ssd_image")"
  hdd_loop="$(losetup --find --show "$hdd_image")"
  mount -o noatime,nodev,nosuid "$ssd_loop" "$ssd_mount"
  mount -o noatime,nodev,nosuid "$hdd_loop" "$hdd_mount"
  mkdir -m 700 "$ssd_mount/internal" "$hdd_mount/internal"
  mkdir -m 770 "$ssd_branch" "$hdd_branch"
  chown 1000:1000 "$ssd_branch" "$hdd_branch"
  jq -n --arg spikeId "$spike_id" --arg role ssd \
    '{schemaVersion:1,spikeId:$spikeId,role:$role}' > "$ssd_mount/.denizcloud-gate1-branch.json"
  jq -n --arg spikeId "$spike_id" --arg role hdd \
    '{schemaVersion:1,spikeId:$spikeId,role:$role}' > "$hdd_mount/.denizcloud-gate1-branch.json"
  chmod 600 "$ssd_mount/.denizcloud-gate1-branch.json" "$hdd_mount/.denizcloud-gate1-branch.json"

  if ! mount_disposable_union; then
    echo "mergerfs did not mount the disposable namespace" >&2
    exit 1
  fi
  chmod 770 "$merged_mount"
  chown 1000:1000 "$merged_mount"

  runuser -u "$spike_user" -- mkdir -m 770 "$merged_mount/personal" "$merged_mount/shared" "$probe_root"
  printf 'deniz-cloud-posix-gate1\n' > "$probe_root/.posix-gate1-disposable"
  chown 1000:1000 "$probe_root/.posix-gate1-disposable"
  chmod 600 "$probe_root/.posix-gate1-disposable"

  jq -n \
    --arg spikeId "$spike_id" \
    --arg root "$state_root" \
    --arg ssdImage "$ssd_image" \
    --arg hddImage "$hdd_image" \
    --arg ssdLoop "$ssd_loop" \
    --arg hddLoop "$hdd_loop" \
    --arg merged "$merged_mount" \
    --arg tailscaleIp "$tailscale_ip" \
    --arg bootId "$(cat /proc/sys/kernel/random/boot_id)" \
    '{schemaVersion:1,phase:"prepared",spikeId:$spikeId,root:$root,images:{ssd:$ssdImage,hdd:$hddImage},loops:{ssd:$ssdLoop,hdd:$hddLoop},mounts:{merged:$merged},tailscaleIp:$tailscaleIp,bootId:$bootId}' \
    > "$state_file"
  chmod 600 "$state_file"
  sync -f "$state_root"
  prepared=true
  trap - EXIT HUP INT TERM
  jq -n --arg spikeId "$spike_id" --arg merged "$merged_mount" \
    '{prepared:true,spikeId:$spikeId,mergedMount:$merged,productionBranchesMounted:false}'
}

validate_live_spike() {
  read_state
  if [[ "$state_phase" == "stopped" ]]; then
    echo "Gate 1 spike is stopped" >&2
    exit 1
  fi
  loop_backing_is "$ssd_loop" "$ssd_image" || { echo "SSD loop backing mismatch" >&2; exit 1; }
  loop_backing_is "$hdd_loop" "$hdd_image" || { echo "HDD loop backing mismatch" >&2; exit 1; }
  mount_source_is "$ssd_mount" "$ssd_loop" || { echo "SSD mount source mismatch" >&2; exit 1; }
  mount_source_is "$hdd_mount" "$hdd_loop" || { echo "HDD mount source mismatch" >&2; exit 1; }
  mountpoint -q "$merged_mount" || { echo "Merged namespace is not mounted" >&2; exit 1; }
  branch_marker_is "$ssd_mount" ssd || { echo "SSD branch marker mismatch" >&2; exit 1; }
  branch_marker_is "$hdd_mount" hdd || { echo "HDD branch marker mismatch" >&2; exit 1; }
}

render_samba_config() {
  local config="$1"
  local spike_user="$2"
  local spike_group="$3"
  if [[ ! -f "$template" || -L "$template" ]]; then
    echo "Samba template is missing or unsafe: ${template}" >&2
    exit 1
  fi
  for value in "$state_root" "$tailscale_ip" "$spike_user" "$spike_group"; do
    if [[ "$value" == *['|&\\']* ]]; then
      echo "Samba template value contains an unsupported character" >&2
      exit 1
    fi
  done
  sed \
    -e "s|@PRIVATE_DIR@|$samba_root/private|g" \
    -e "s|@STATE_DIR@|$samba_root/state|g" \
    -e "s|@CACHE_DIR@|$samba_root/cache|g" \
    -e "s|@LOCK_DIR@|$samba_root/lock|g" \
    -e "s|@PID_DIR@|$samba_root/pid|g" \
    -e "s|@NCALRPC_DIR@|$samba_root/ncalrpc|g" \
    -e "s|@LOG_DIR@|$samba_root/log|g" \
    -e "s|@TAILSCALE_IP@|$tailscale_ip|g" \
    -e "s|@MERGED_ROOT@|$merged_mount|g" \
    -e "s|@SPIKE_USER@|$spike_user|g" \
    -e "s|@SPIKE_GROUP@|$spike_group|g" \
    "$template" > "$config"
  chmod 600 "$config"
}

firewall_is_current_spike() {
  local ruleset table_comment health_comment allow_comment deny_comment
  table_comment="deniz-cloud-gate1-${spike_id}"
  health_comment="deniz-cloud-gate1-${spike_id}-health"
  allow_comment="deniz-cloud-gate1-${spike_id}-allow"
  deny_comment="deniz-cloud-gate1-${spike_id}-deny"
  ruleset="$(nft -j list table inet "$firewall_table" 2>/dev/null || true)"
  [[ -n "$ruleset" ]] && jq -e \
    --arg table "$firewall_table" \
    --arg tableComment "$table_comment" \
    --arg health "$health_comment" \
    --arg allow "$allow_comment" \
    --arg deny "$deny_comment" '
      def rules: [.nftables[] | .rule? | select(.family == "inet" and .table == $table and .chain == "input")];
      def chains: [.nftables[] | .chain? | select(.family == "inet" and .table == $table)];
      def tcp445: .match.op == "==" and .match.left.payload.protocol == "tcp" and .match.left.payload.field == "dport" and .match.right == 445;
      def iif($name): .match.op == "==" and .match.left.meta.key == "iifname" and .match.right == $name;
      def ipv4localhost: .match.op == "==" and .match.left.payload.protocol == "ip" and .match.left.payload.field == "daddr" and .match.right == "127.0.0.1";
      ([.nftables[] | .table? | select(.family == "inet" and .name == $table and .comment == $tableComment)] | length) == 1 and
      (chains | length) == 1 and
      (chains[0].name == "input" and chains[0].type == "filter" and chains[0].hook == "input" and chains[0].prio == -100 and chains[0].policy == "accept") and
      (rules | length) == 3 and
      (rules[0].comment == $health and (rules[0].expr | length) == 4 and (rules[0].expr[0] | iif("lo")) and (rules[0].expr[1] | ipv4localhost) and (rules[0].expr[2] | tcp445) and (rules[0].expr[3] | has("accept") and .accept == null)) and
      (rules[1].comment == $allow and (rules[1].expr | length) == 3 and (rules[1].expr[0] | iif("tailscale0")) and (rules[1].expr[1] | tcp445) and (rules[1].expr[2] | has("accept") and .accept == null)) and
      (rules[2].comment == $deny and (rules[2].expr | length) == 2 and (rules[2].expr[0] | tcp445) and rules[2].expr[1].reject.type == "tcp reset")
    ' <<< "$ruleset" >/dev/null
}

install_gate1_firewall() {
  if nft list table inet "$firewall_table" >/dev/null 2>&1; then
    echo "Refusing to replace an existing Gate 1 firewall table" >&2
    return 1
  fi
  if ! ip link show dev tailscale0 | grep -q '<[^>]*UP[^>]*>' \
    || ! ip -4 -o address show dev tailscale0 | awk -v expected="$tailscale_ip" '{split($4, value, "/"); if (value[1] == expected) found=1} END {exit found ? 0 : 1}'; then
    echo "tailscale0 is not up with the saved Gate 1 IPv4 address" >&2
    return 1
  fi
  nft -f - <<EOF
add table inet $firewall_table { comment "deniz-cloud-gate1-${spike_id}"; }
add chain inet $firewall_table input { type filter hook input priority -100; policy accept; }
add rule inet $firewall_table input iifname "lo" ip daddr 127.0.0.1 tcp dport 445 accept comment "deniz-cloud-gate1-${spike_id}-health"
add rule inet $firewall_table input iifname "tailscale0" tcp dport 445 accept comment "deniz-cloud-gate1-${spike_id}-allow"
add rule inet $firewall_table input tcp dport 445 reject with tcp reset comment "deniz-cloud-gate1-${spike_id}-deny"
EOF
  firewall_is_current_spike || {
    echo "Gate 1 firewall did not match the exact spike-scoped rules" >&2
    nft -j list table inet "$firewall_table" >&2 2>/dev/null || true
    nft delete table inet "$firewall_table" >/dev/null 2>&1 || true
    return 1
  }
}

remove_gate1_firewall() {
  if ! nft list table inet "$firewall_table" >/dev/null 2>&1; then
    return 0
  fi
  if ! firewall_is_current_spike; then
    echo "Refusing to remove an unverified Gate 1 firewall table" >&2
    return 1
  fi
  nft delete table inet "$firewall_table"
  ! nft list table inet "$firewall_table" >/dev/null 2>&1
}

startup_process_is_verified() {
  local pid="$1"
  local actual_start_time launch_floor
  [[ "$pid" =~ ^[0-9]+$ && -n "$startup_config" && -r "/proc/$pid/exe" ]] || return 1
  [[ "$(basename "$(readlink -f "/proc/$pid/exe")")" == "smbd" ]] || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "$startup_config" || return 1
  actual_start_time="$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true)"
  launch_floor="$(jq -r '.samba.launchFloor // 0' "$state_file" 2>/dev/null || printf 0)"
  [[ "$actual_start_time" =~ ^[0-9]+$ && "$launch_floor" =~ ^[0-9]+$ ]] \
    && (( actual_start_time >= launch_floor ))
}

startup_probe_process_is_verified() {
  local pid="$1"
  startup_probe_identity_is_current "$pid" || return 1
  [[ -n "${startup_auth_file:-}" && -r "/proc/$pid/exe" ]] || return 1
  [[ "$(basename "$(readlink -f "/proc/$pid/exe")")" == "timeout" ]] || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "smbclient" || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "//127.0.0.1/Personal" || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "$startup_auth_file" || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "SMB3" || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "--client-protection=off" || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "notify ." || return 1
}

startup_probe_command_remains() {
  local process_cmdline
  [[ -n "${startup_auth_file:-}" ]] || return 1
  for process_cmdline in /proc/[0-9]*/cmdline; do
    if [[ -r "$process_cmdline" ]] \
      && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "smbclient" \
      && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "//127.0.0.1/Personal" \
      && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "$startup_auth_file" \
      && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "--client-protection=off" \
      && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "notify ."; then
      return 0
    fi
  done
  return 1
}

startup_probe_identity_is_current() {
  local pid="$1"
  local actual_parent actual_start_time
  [[ "$pid" =~ ^[0-9]+$ && "$startup_probe_start_time" =~ ^[0-9]+$ && -r "/proc/$pid/stat" ]] || return 1
  actual_parent="$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null || true)"
  actual_start_time="$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true)"
  [[ "$actual_parent" == "$$" && "$actual_start_time" == "$startup_probe_start_time" ]]
}

stop_startup_encryption_probe() {
  local pid="${startup_probe_pid:-}"
  local process_state=""
  if [[ ! "$pid" =~ ^[0-9]+$ ]]; then
    return 0
  fi
  if startup_probe_identity_is_current "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  for _ in {1..20}; do
    startup_probe_identity_is_current "$pid" || break
    process_state="$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)"
    [[ "$process_state" == "Z" ]] && break
    sleep 0.1
  done
  process_state="$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)"
  if startup_probe_identity_is_current "$pid" && [[ "$process_state" != "Z" ]]; then
    kill -KILL "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      startup_probe_identity_is_current "$pid" || break
      process_state="$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)"
      [[ "$process_state" == "Z" ]] && break
      sleep 0.1
    done
  fi
  process_state="$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)"
  if startup_probe_identity_is_current "$pid" && [[ "$process_state" != "Z" ]]; then
    echo "Encrypted SMB observation client did not terminate" >&2
    return 1
  fi
  wait "$pid" 2>/dev/null || true
  for _ in {1..30}; do
    startup_probe_command_remains || break
    sleep 0.1
  done
  if startup_probe_command_remains; then
    echo "Encrypted SMB observation command remains after wrapper withdrawal" >&2
    return 1
  fi
  startup_probe_pid=""
  startup_probe_start_time=""
}

cleanup_failed_samba() {
  set +e
  local failed_pid="${startup_pid:-}"
  local listener_remains=false exact_process_remains=false
  stop_startup_encryption_probe || true
  if [[ ! "$failed_pid" =~ ^[0-9]+$ && -n "${startup_pid_file:-}" && -s "$startup_pid_file" ]]; then
    failed_pid="$(cat "$startup_pid_file")"
  fi
  if startup_process_is_verified "$failed_pid"; then
    kill -TERM "$failed_pid"
    for _ in {1..50}; do
      [[ ! -e "/proc/$failed_pid" ]] && break
      sleep 0.1
    done
    if startup_process_is_verified "$failed_pid"; then
      kill -KILL "$failed_pid"
      for _ in {1..50}; do
        [[ ! -e "/proc/$failed_pid" ]] && break
        sleep 0.1
      done
    fi
  fi
  if [[ -n "${startup_config:-}" ]]; then
    local process_cmdline
    for process_cmdline in /proc/[0-9]*/cmdline; do
      if [[ -r "$process_cmdline" ]] && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "$startup_config"; then
        exact_process_remains=true
        break
      fi
    done
  fi
  ss -H -ltn 'sport = :445' | grep -q . && listener_remains=true
  find "${startup_auth_file:-$samba_root/client.auth}" -maxdepth 0 -type f -delete 2>/dev/null || true
  if [[ "$exact_process_remains" == "true" || "$listener_remains" == "true" ]]; then
    echo "STOP: retaining the Gate 1 firewall because Samba withdrawal is unproven" >&2
    return
  fi
  remove_gate1_firewall || {
    echo "STOP: failed to remove the verified Gate 1 firewall" >&2
    return
  }
  if [[ -n "${startup_pid_file:-}" ]]; then
    find "$startup_pid_file" -maxdepth 0 -type f -delete 2>/dev/null || true
  fi
  if [[ -f "$state_file" && "$(jq -r '.phase // ""' "$state_file" 2>/dev/null)" == "starting" ]]; then
    jq '.phase="prepared" | del(.samba) | .safety={status:"failed-samba-start-withdrawn"}' \
      "$state_file" > "$state_file.partial"
    mv "$state_file.partial" "$state_file"
    chmod 600 "$state_file"
  fi
}

state_samba_process_is_verified() {
  local pid="$1"
  local expected_pid expected_start_time expected_config launch_floor actual_start_time
  [[ "$pid" =~ ^[0-9]+$ && -r "/proc/$pid/exe" ]] || return 1
  expected_pid="$(jq -r '.samba.pid // ""' "$state_file")"
  expected_start_time="$(jq -r '.samba.startTime // ""' "$state_file")"
  expected_config="$(jq -er '.samba.config' "$state_file")"
  launch_floor="$(jq -er '.samba.launchFloor' "$state_file")"
  actual_start_time="$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true)"
  [[ "$expected_config" == "$samba_root/smb.conf" \
    && "$launch_floor" =~ ^[0-9]+$ \
    && "$actual_start_time" =~ ^[0-9]+$ \
    && "$(basename "$(readlink -f "/proc/$pid/exe")")" == "smbd" ]] || return 1
  (( actual_start_time >= launch_floor )) || return 1
  [[ -z "$expected_pid" || "$pid" == "$expected_pid" ]] || return 1
  [[ -z "$expected_start_time" || "$actual_start_time" == "$expected_start_time" ]] || return 1
  tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "$expected_config"
}

recover_withdrawn_samba_start() {
  [[ "$state_phase" == "starting" ]] || return 0
  local expected_config="$samba_root/smb.conf"
  local saved_config process_cmdline pid_file auth_file stale_file
  saved_config="$(jq -er '.samba.config' "$state_file")"
  [[ "$saved_config" == "$expected_config" ]] || {
    echo "Refusing recovery with an unexpected Samba configuration path" >&2
    exit 1
  }
  for process_cmdline in /proc/[0-9]*/cmdline; do
    if [[ -r "$process_cmdline" ]] && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "$expected_config"; then
      echo "Refusing recovery while the exact Gate 1 Samba process remains" >&2
      exit 1
    fi
  done
  if ss -H -ltn 'sport = :445' | grep -q .; then
    echo "Refusing recovery while TCP 445 has a listener" >&2
    exit 1
  fi
  if nft list table inet "$firewall_table" >/dev/null 2>&1; then
    firewall_is_current_spike || {
      echo "Refusing recovery with a foreign Gate 1 firewall" >&2
      exit 1
    }
    remove_gate1_firewall || {
      echo "Could not withdraw the verified stale Gate 1 firewall" >&2
      exit 1
    }
  fi
  pid_file="$samba_root/pid/gate1-smbd.pid"
  auth_file="$samba_root/client.auth"
  for stale_file in "$pid_file" "$auth_file"; do
    if [[ -L "$stale_file" ]]; then
      echo "Refusing recovery with a symlinked Samba runtime file: ${stale_file}" >&2
      exit 1
    fi
    find "$stale_file" -maxdepth 0 -type f -delete 2>/dev/null || true
  done
  jq '.phase="prepared" | del(.samba) | .safety={status:"stale-samba-start-withdrawn"}' \
    "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  state_phase=prepared
}

start_samba() {
  validate_live_spike
  recover_withdrawn_samba_start
  if [[ "$state_phase" != "prepared" ]]; then
    echo "Samba can start only from the prepared phase" >&2
    exit 1
  fi
  if ss -H -ltn 'sport = :445' | grep -q .; then
    echo "TCP 445 already has a listener" >&2
    exit 1
  fi
  tailscale_ip="$(jq -er '.tailscaleIp' "$state_file")"
  local spike_user spike_group config auth_file password pid pid_file start_time launch_floor
  local effective_encryption encryption_observed=false probe_started=false smbstatus_json="" probe_log probe_parent=""
  spike_user="$(getent passwd 1000 | cut -d: -f1)"
  spike_group="$(getent group 1000 | cut -d: -f1)"
  if [[ ! "$spike_user" =~ ^[a-z_][a-z0-9_-]*$ || ! "$spike_group" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
    echo "UID/GID 1000 do not resolve to safe Samba identities" >&2
    exit 1
  fi
  mkdir -p "$samba_root/private" "$samba_root/state" "$samba_root/cache" "$samba_root/lock" "$samba_root/pid" "$samba_root/ncalrpc" "$samba_root/log"
  chmod 700 "$samba_root/private" "$samba_root/pid" "$samba_root/log"
  chmod 755 "$samba_root/state" "$samba_root/cache" "$samba_root/lock" "$samba_root/ncalrpc"
  pid_file="$samba_root/pid/gate1-smbd.pid"
  if [[ -e "$pid_file" || -L "$pid_file" ]]; then
    echo "Refusing Samba start with a stale disposable PID file" >&2
    exit 1
  fi
  startup_pid_file="$pid_file"
  trap cleanup_failed_samba EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  config="$samba_root/smb.conf"
  auth_file="$samba_root/client.auth"
  startup_config="$config"
  startup_auth_file="$auth_file"
  render_samba_config "$config" "$spike_user" "$spike_group"
  testparm -s "$config" > "$samba_root/testparm.txt"
  chmod 600 "$samba_root/testparm.txt"

  password="$(openssl rand -hex 24)"
  printf '%s\n%s\n' "$password" "$password" | smbpasswd -s -c "$config" -a "$spike_user" >/dev/null
  printf 'username = %s\npassword = %s\n' "$spike_user" "$password" > "$auth_file"
  unset password
  chmod 600 "$auth_file"
  chown 1000:1000 "$auth_file"

  launch_floor="$(awk '{print $22}' "/proc/$$/stat")"
  [[ "$launch_floor" =~ ^[0-9]+$ ]] || { echo "Could not capture the Samba launch floor" >&2; exit 1; }
  jq --arg config "$config" --argjson launchFloor "$launch_floor" \
    '.phase="starting" | .samba={pid:null,startTime:null,launchFloor:$launchFloor,config:$config,firewall:{family:"inet",table:"deniz_cloud_gate1",interface:"tailscale0",port:445}}' \
    "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  state_phase=starting
  install_gate1_firewall
  smbd --foreground --no-process-group --debug-stdout -s "$config" >> "$samba_root/log/smbd.foreground.log" 2>&1 &
  pid=$!
  startup_pid="$pid"
  printf '%s\n' "$pid" > "$pid_file"
  chmod 600 "$pid_file"
  for _ in {1..20}; do
    [[ -r "/proc/$pid/exe" ]] && break
    sleep 0.1
  done
  if [[ ! "$pid" =~ ^[0-9]+$ || ! -r "/proc/$pid/exe" || "$(basename "$(readlink -f "/proc/$pid/exe")")" != "smbd" ]]; then
    echo "Disposable smbd did not produce a verifiable master PID" >&2
    tail -n 120 "$samba_root/log/smbd.foreground.log" >&2 || true
    exit 1
  fi
  if ! tr '\0' '\n' < "/proc/$pid/cmdline" | grep -Fxq -- "$config"; then
    echo "Disposable smbd does not reference the exact Gate 1 configuration" >&2
    exit 1
  fi
  start_time="$(awk '{print $22}' "/proc/$pid/stat")"
  [[ "$start_time" =~ ^[0-9]+$ ]] || { echo "Disposable smbd start time is invalid" >&2; exit 1; }
  jq --argjson pid "$pid" --arg startTime "$start_time" \
    '.samba.pid=$pid | .samba.startTime=$startTime' "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  for _ in {1..50}; do
    ss -H -ltn 'sport = :445' | grep -q . && break
    sleep 0.1
  done
  if ! ss -H -ltn 'sport = :445' | awk '$4 == "0.0.0.0:445" || $4 == "[::]:445" {found=1} END {exit found ? 0 : 1}'; then
    echo "Disposable smbd did not open a firewall-protected wildcard listener" >&2
    tail -n 80 "$samba_root/log/smbd.foreground.log" >&2 || true
    exit 1
  fi
  firewall_is_current_spike || { echo "Disposable Samba firewall verification failed" >&2; exit 1; }
  effective_encryption="$(testparm -s --parameter-name='server smb encrypt' "$config" 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [[ "$effective_encryption" != "required" ]]; then
    echo "Effective Samba encryption policy is not required" >&2
    exit 1
  fi
  probe_log="$samba_root/log/encryption-probe.log"
  : > "$probe_log"
  timeout --signal=TERM --kill-after=2s 12s \
    smbclient "//127.0.0.1/Personal" -A "$auth_file" -m SMB3 --client-protection=off \
    -c 'notify .' > "$probe_log" 2>&1 &
  startup_probe_pid=$!
  for _ in {1..20}; do
    if [[ -r "/proc/$startup_probe_pid/stat" ]]; then
      probe_parent="$(awk '{print $4}' "/proc/$startup_probe_pid/stat" 2>/dev/null || true)"
      startup_probe_start_time="$(awk '{print $22}' "/proc/$startup_probe_pid/stat" 2>/dev/null || true)"
      if [[ "$probe_parent" == "$$" && "$startup_probe_start_time" =~ ^[0-9]+$ ]]; then
        break
      fi
    fi
    sleep 0.1
  done
  if [[ "$probe_parent" != "$$" || ! "$startup_probe_start_time" =~ ^[0-9]+$ ]]; then
    echo "Encrypted SMB observation client identity was not captured" >&2
    exit 1
  fi
  for _ in {1..20}; do
    if startup_probe_process_is_verified "$startup_probe_pid"; then
      probe_started=true
      break
    fi
    [[ -e "/proc/$startup_probe_pid" ]] || break
    sleep 0.1
  done
  if [[ "$probe_started" != "true" ]]; then
    echo "Encrypted SMB observation client did not start predictably" >&2
    tail -n 80 "$probe_log" >&2 || true
    exit 1
  fi
  for _ in {1..50}; do
    if ! startup_probe_process_is_verified "$startup_probe_pid"; then
      break
    fi
    smbstatus_json="$(timeout --kill-after=1s 2s smbstatus --json -s "$config" 2>/dev/null || true)"
    if jq -e --arg username "$spike_user" '
      def fully_encrypted:
        ((.encryption.cipher? // "") != "") and
        (((.encryption.degree? // "") | ascii_downcase) == "full");
      . as $root |
      ([$root.tcons[]? as $tcon
        | select(($tcon.service? // "") == "Personal")
        | select($tcon | fully_encrypted)
        | ($root.sessions[($tcon.session_id | tostring)]? // empty) as $session
        | select(($session.username? // "") == $username)
        | select(($session.remote_machine? // "") == "127.0.0.1")
        | select(($session.session_dialect? // "") | startswith("SMB3_"))]
        | length) >= 1
    ' <<< "$smbstatus_json" >/dev/null 2>&1; then
      encryption_observed=true
      break
    fi
    sleep 0.1
  done
  if [[ "$encryption_observed" != "true" ]]; then
    echo "Could not observe a fully encrypted SMB3 Personal session" >&2
    [[ -n "$smbstatus_json" ]] && printf '%s\n' "$smbstatus_json" >&2
    tail -n 80 "$probe_log" >&2 || true
    exit 1
  fi
  printf '%s\n' "$smbstatus_json" > "$samba_root/encryption-status.json"
  chmod 600 "$samba_root/encryption-status.json"
  stop_startup_encryption_probe || { echo "Could not withdraw the encrypted SMB observation client" >&2; exit 1; }
  jq '.phase="samba"' \
    "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  state_phase=samba
  trap - EXIT HUP INT TERM
  jq -n --arg host "$tailscale_ip" --arg user "$spike_user" \
    --arg evidence "$samba_root/encryption-status.json" \
    '{sambaStarted:true,host:$host,port:445,share:"Personal",user:$user,encryptionRequired:true,encryptionObserved:true,encryptionEvidence:$evidence,credentialsFile:"private on Pi"}'
}

record_host_event() {
  local evidence="$1"
  local event="$2"
  local status="$3"
  jq -nc --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg event "$event" --arg status "$status" \
    '{schemaVersion:1,at:$at,event:$event,status:$status}' >> "$evidence"
}

run_host_tests() {
  validate_live_spike
  if [[ "$state_phase" != "samba" ]]; then
    echo "Host tests require the Samba phase" >&2
    exit 1
  fi
  tailscale_ip="$(jq -er '.tailscaleIp' "$state_file")"
  local auth_file="$samba_root/client.auth"
  local evidence="$evidence_dir/host-${spike_id}.jsonl"
  local test_name=".gate1-${spike_id}"
  local test_dir="$merged_mount/personal/$test_name"
  local ssd_test="$ssd_branch/personal/$test_name"
  local hdd_test="$hdd_branch/personal/$test_name"
  local external="$ssd_mount/internal/host-test"
  local spike_user acl_uid api_image available block_size fill_bytes expected protected_value
  if [[ -e "$evidence" || -e "$test_dir" || -L "$test_dir" ]]; then
    echo "Refusing to overwrite Gate 1 host evidence or test root" >&2
    exit 1
  fi
  spike_user="$(getent passwd 1000 | cut -d: -f1)"
  acl_uid="$(getent passwd nobody | cut -d: -f3)"
  if [[ ! "$acl_uid" =~ ^[0-9]+$ || "$acl_uid" == "1000" ]]; then
    echo "A distinct nobody account is required for the ACL round-trip probe" >&2
    exit 1
  fi
  api_image="$(docker inspect --format '{{.Config.Image}}' deniz-cloud-api-1)"
  mkdir -m 700 "$external"
  printf 'smb-exact-bytes\n' > "$external/upload.txt"
  chmod 600 "$external/upload.txt"
  touch "$evidence"
  chmod 600 "$evidence"
  record_host_event "$evidence" run start

  cleanup_host_test() {
    set +e
    if [[ "$test_dir" == "$merged_mount/personal/.gate1-$spike_id" && -d "$test_dir" ]]; then
      find "$test_dir" -depth -delete
    fi
    if [[ "$external" == "$ssd_mount/internal/host-test" && -d "$external" ]]; then
      find "$external" -depth -delete
    fi
  }
  trap cleanup_host_test EXIT HUP INT TERM

  runuser -u "$spike_user" -- mkdir -m 700 "$test_dir"
  runuser -u "$spike_user" -- sh -c 'printf "ssd\n" > "$1"' sh "$test_dir/ssd-first.txt"
  [[ -f "$ssd_test/ssd-first.txt" && ! -e "$hdd_test/ssd-first.txt" ]]
  record_host_event "$evidence" ssd-preferred-create pass

  runuser -u "$spike_user" -- sh -c 'printf "metadata\n" > "$1"' sh "$test_dir/metadata.txt"
  protected_value="$(cat /proc/sys/kernel/random/uuid)"
  setfattr -n user.denizcloud.id -v "$protected_value" "$test_dir/metadata.txt"
  setfacl -m "u:${acl_uid}:r--" "$test_dir/metadata.txt"
  runuser -u "$spike_user" -- mv "$test_dir/metadata.txt" "$test_dir/Metadata-Renamed.txt"
  [[ "$(getfattr --only-values -n user.denizcloud.id "$test_dir/Metadata-Renamed.txt")" == "$protected_value" ]]
  getfacl -cpn "$test_dir/Metadata-Renamed.txt" | grep -q "^user:${acl_uid}:r--"
  record_host_event "$evidence" rename-xattr-acl pass

  runuser -u "$spike_user" -- sh -c 'printf "container\n" > "$1"' sh "$test_dir/container-source.txt"
  docker run --rm --network none --read-only --tmpfs /tmp --user 1000:1000 \
    --volume "$merged_mount:/gate1" --entrypoint /bin/sh "$api_image" \
    -c "mv /gate1/personal/$test_name/container-source.txt /gate1/personal/$test_name/container-renamed.txt"
  [[ -f "$test_dir/container-renamed.txt" ]]
  record_host_event "$evidence" highest-bind-container-rename pass

  read -r available block_size < <(stat -f -c '%a %S' "$ssd_mount")
  fill_bytes=$((available * block_size - 64 * 1024 * 1024))
  if (( fill_bytes <= 0 )); then
    echo "Disposable SSD image is too small for reserve testing" >&2
    exit 1
  fi
  fallocate -l "$fill_bytes" "$external/reserve.fill"
  runuser -u "$spike_user" -- sh -c 'printf "hdd\n" > "$1"' sh "$test_dir/hdd-fallback.txt"
  [[ -f "$hdd_test/hdd-fallback.txt" && ! -e "$ssd_test/hdd-fallback.txt" ]]
  find "$external/reserve.fill" -delete
  record_host_event "$evidence" deterministic-hdd-fallback pass

  smbclient "//127.0.0.1/Personal" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "put $external/upload.txt $test_name/smb-upload.txt; rename $test_name/smb-upload.txt $test_name/smb-renamed.txt; get $test_name/smb-renamed.txt $external/download.txt" >/dev/null
  expected="$(sha256sum "$external/upload.txt" | awk '{print $1}')"
  [[ "$(sha256sum "$external/download.txt" | awk '{print $1}')" == "$expected" ]]
  record_host_event "$evidence" smb3-encrypted-roundtrip pass

  setfattr -n user.denizcloud.id -v "$protected_value" "$test_dir/smb-renamed.txt"
  printf 'named-stream\n' > "$external/stream.txt"
  smbclient "//127.0.0.1/Personal" -A "$auth_file" -m SMB3 --client-protection=encrypt \
    -c "put $external/stream.txt $test_name/smb-renamed.txt:denizcloud.id; get $test_name/smb-renamed.txt:denizcloud.id $external/stream-out.txt" >/dev/null
  [[ "$(getfattr --only-values -n user.denizcloud.id "$test_dir/smb-renamed.txt")" == "$protected_value" ]]
  [[ "$(sha256sum "$external/stream.txt" | awk '{print $1}')" == "$(sha256sum "$external/stream-out.txt" | awk '{print $1}')" ]]
  record_host_event "$evidence" protected-xattr-stream-isolation pass

  mkdir "$external/restore"
  tar --acls --xattrs --xattrs-include='*' -cf "$external/metadata.tar" -C "$test_dir" Metadata-Renamed.txt
  tar --acls --xattrs --xattrs-include='*' -xf "$external/metadata.tar" -C "$external/restore"
  [[ "$(getfattr --only-values -n user.denizcloud.id "$external/restore/Metadata-Renamed.txt")" == "$protected_value" ]]
  getfacl -cpn "$external/restore/Metadata-Renamed.txt" | grep -q "^user:${acl_uid}:r--"
  record_host_event "$evidence" backup-restore-xattr-acl pass

  record_host_event "$evidence" run pass
  trap - EXIT HUP INT TERM
  cleanup_host_test
  jq -n --arg evidence "$evidence" \
    '{partialHostTestsPassed:true,evidence:$evidence,gate1Passed:false,pending:["API Bun/Range/TUS/slow-client probe","raw hardlink and symlink ingress","name-policy matrix","API-SMB concurrency and open handles","tier-move crash points","live branch loss and reboot","Finder and Explorer native-app checks","LAN and relay performance"]}'
}

run_api_tests() {
  validate_live_spike
  if [[ ! -f "$probe_bundle" || -L "$probe_bundle" ]]; then
    echo "Bundled Gate 1 API probe is missing or unsafe: ${probe_bundle}" >&2
    exit 1
  fi
  if [[ ! -f "$slow_client_bundle" || -L "$slow_client_bundle" ]]; then
    echo "Bundled Gate 1 slow-client probe is missing or unsafe: ${slow_client_bundle}" >&2
    exit 1
  fi
  local api_image probe_evidence_dir result_file log_file slow_result_file slow_log_file
  api_image="$(docker inspect --format '{{.Config.Image}}' deniz-cloud-api-1)"
  if [[ -z "$api_image" ]]; then
    echo "Could not resolve the deployed API image" >&2
    exit 1
  fi
  probe_evidence_dir="$evidence_dir/api-${spike_id}"
  result_file="$probe_evidence_dir/summary.json"
  log_file="$probe_evidence_dir/checks.jsonl"
  slow_result_file="$probe_evidence_dir/slow-summary.json"
  slow_log_file="$probe_evidence_dir/slow-check.jsonl"
  if [[ -e "$probe_evidence_dir" || -L "$probe_evidence_dir" ]]; then
    echo "Refusing to overwrite Gate 1 API evidence" >&2
    exit 1
  fi
  mkdir -m 700 "$probe_evidence_dir"
  chown 1000:1000 "$probe_evidence_dir"

  docker run --rm --network none --read-only --tmpfs /tmp --user 1000:1000 \
    --volume "$probe_bundle:/gate1-probe.js:ro" \
    --volume "$merged_mount:/gate1" \
    --volume "$probe_evidence_dir:/evidence" \
    --entrypoint bun "$api_image" \
    /gate1-probe.js --execute --root /gate1/posix-gate1-disposable --log /evidence/checks.jsonl \
    > "$result_file"
  chmod 600 "$result_file"
  chown root:root "$result_file"
  [[ -s "$log_file" && ! -L "$log_file" ]] || { echo "API probe evidence is missing" >&2; exit 1; }
  jq -e '
    .probe == "posix-gate1" and
    .dryRun == false and
    ([.checks[] | select(.status == "pass") | .name] | index("same-mount-atomic-rename") != null) and
    ([.checks[] | select(.status == "pass") | .name] | index("tus-interrupt-fsync-resume-publish") != null) and
    ([.checks[] | select(.status == "pass") | .name] | index("bun-file-full-range-and-sparse-offset") != null) and
    ([.checks[] | select(.status == "pass") | .name] | index("mmap-shared-write-msync") != null)
  ' "$result_file" >/dev/null
  docker run --rm --network none --read-only --tmpfs /tmp --user 1000:1000 \
    --volume "$slow_client_bundle:/gate1-slow-client.js:ro" \
    --volume "$merged_mount:/gate1" \
    --volume "$probe_evidence_dir:/evidence" \
    --entrypoint bun "$api_image" \
    /gate1-slow-client.js --execute --root /gate1/posix-gate1-disposable --log /evidence/slow-check.jsonl \
    > "$slow_result_file"
  chmod 600 "$slow_result_file"
  chown root:root "$slow_result_file"
  [[ -s "$slow_log_file" && ! -L "$slow_log_file" ]] || { echo "Slow-client evidence is missing" >&2; exit 1; }
  jq -e '
    .probe == "posix-gate1-slow-client" and
    .dryRun == false and
    .allGreen == true and
    .logicalBytes == 5800000000 and
    .rssDeltaBytes <= .maxRssDeltaBytes
  ' "$slow_result_file" >/dev/null
  jq -n --arg evidence "$probe_evidence_dir" --arg image "$api_image" \
    '{partialApiTestsPassed:true,gate1Passed:false,evidence:$evidence,deployedRuntimeImage:$image,slowClientShapeBytes:5800000000,pending:["SMB concurrency","native clients","branch loss/reboot","throughput"]}'
}

append_safety_event() {
  local evidence="$1"
  local event="$2"
  local status="$3"
  local detail="$4"
  jq -nc \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg event "$event" \
    --arg status "$status" \
    --arg detail "$detail" \
    '{schemaVersion:1,at:$at,event:$event,status:$status,detail:$detail}' >> "$evidence"
}

stop_verified_samba_for_watchdog() {
  local pid_file="$samba_root/pid/gate1-smbd.pid"
  if [[ "$state_phase" != "samba" && "$state_phase" != "starting" ]]; then
    if [[ -s "$pid_file" ]] || ss -H -ltn 'sport = :445' | grep -q .; then
      echo "STOP: Samba state is ambiguous; watchdog will not signal an unverified listener" >&2
      return 1
    fi
    remove_gate1_firewall || return 1
    return 0
  fi
  local pid="" expected_pid process_cmdline candidate_pid candidate_count=0
  if [[ -s "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
  else
    expected_pid="$(jq -r '.samba.pid // ""' "$state_file")"
    if [[ "$expected_pid" =~ ^[0-9]+$ ]]; then
      pid="$expected_pid"
    else
      for process_cmdline in /proc/[0-9]*/cmdline; do
        candidate_pid="${process_cmdline#/proc/}"
        candidate_pid="${candidate_pid%/cmdline}"
        if state_samba_process_is_verified "$candidate_pid"; then
          pid="$candidate_pid"
          candidate_count=$((candidate_count + 1))
        fi
      done
      if (( candidate_count > 1 )); then
        echo "STOP: multiple disposable Samba processes match the starting state" >&2
        return 1
      fi
    fi
  fi
  if [[ -z "$pid" ]]; then
    if ss -H -ltn 'sport = :445' | grep -q .; then
      echo "STOP: Samba phase has a listener but no verified PID" >&2
      return 1
    fi
    remove_gate1_firewall || return 1
    return 0
  fi
  if [[ "$pid" =~ ^[0-9]+$ && ! -e "/proc/$pid" ]]; then
    if ss -H -ltn 'sport = :445' | grep -q .; then
      echo "STOP: Samba PID is gone but a port-445 listener remains" >&2
      return 1
    fi
    find "$pid_file" -maxdepth 0 -type f -delete 2>/dev/null || true
    remove_gate1_firewall || return 1
    return 0
  fi
  if ! state_samba_process_is_verified "$pid"; then
    echo "STOP: refusing to signal an unverified Samba PID" >&2
    return 1
  fi

  kill -TERM "$pid"
  for _ in {1..50}; do
    [[ ! -e "/proc/$pid" ]] && break
    sleep 0.1
  done
  if state_samba_process_is_verified "$pid"; then
    kill -KILL "$pid"
    for _ in {1..50}; do
      [[ ! -e "/proc/$pid" ]] && break
      sleep 0.1
    done
  fi
  if [[ -e "/proc/$pid" ]] || ss -H -ltn 'sport = :445' | grep -q .; then
    echo "STOP: disposable Samba did not withdraw within 10 seconds" >&2
    return 1
  fi
  find "$pid_file" -maxdepth 0 -type f -delete 2>/dev/null || true
  remove_gate1_firewall || return 1
}

quarantine_spike() {
  local reason="$1"
  jq --arg reason "$reason" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.phase="quarantined" | .safety={status:"fail-closed",reason:$reason,at:$at}' \
    "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  state_phase="quarantined"
}

# Returns 0 when healthy, 10 when a fault was detected and safely withdrawn,
# and 20 when safety could not be proven. It never unmounts a branch device.
watchdog_once() {
  local evidence="$1"
  local saved_boot_id current_boot_id reason
  saved_boot_id="$(jq -r '.bootId // "missing"' "$state_file")"
  current_boot_id="$(cat /proc/sys/kernel/random/boot_id)"
  if [[ "$saved_boot_id" != "$current_boot_id" ]]; then
    append_safety_event "$evidence" watchdog stop "boot identity changed; no live resource will be touched"
    return 20
  fi

  reason=""
  if [[ "$state_phase" == "quarantined" ]]; then
    reason="state-quarantined"
  fi
  if [[ "$state_phase" == "starting" ]]; then
    reason="samba-starting"
  fi
  loop_backing_is "$ssd_loop" "$ssd_image" || reason="ssd-loop-backing"
  loop_backing_is "$hdd_loop" "$hdd_image" || reason="${reason:+$reason,}hdd-loop-backing"
  mount_source_is "$ssd_mount" "$ssd_loop" || reason="${reason:+$reason,}ssd-mount-source"
  mount_source_is "$hdd_mount" "$hdd_loop" || reason="${reason:+$reason,}hdd-mount-source"
  branch_marker_is "$ssd_mount" ssd || reason="${reason:+$reason,}ssd-marker"
  branch_marker_is "$hdd_mount" hdd || reason="${reason:+$reason,}hdd-marker"
  merged_mount_is_disposable || reason="${reason:+$reason,}merged-mount"
  if [[ "$state_phase" =~ ^(starting|samba)$ ]] && ! firewall_is_current_spike; then
    reason="${reason:+$reason,}samba-firewall"
  fi
  if [[ -z "$reason" ]]; then
    append_safety_event "$evidence" watchdog pass "both disposable branches and the merged mount are healthy"
    return 0
  fi

  append_safety_event "$evidence" watchdog detected "$reason"
  if ! stop_verified_samba_for_watchdog; then
    append_safety_event "$evidence" watchdog stop "could not prove Samba withdrawal"
    return 20
  fi
  if mountpoint -q "$merged_mount"; then
    if ! merged_mount_is_disposable; then
      append_safety_event "$evidence" watchdog stop "refusing to unmount an unexpected filesystem"
      return 20
    fi
    if ! timeout --kill-after=2s "$watchdog_timeout_seconds" umount "$merged_mount"; then
      append_safety_event "$evidence" watchdog stop "merged mount did not withdraw within the deadline"
      return 20
    fi
  fi
  if mountpoint -q "$merged_mount" || ss -H -ltn 'sport = :445' | grep -q .; then
    append_safety_event "$evidence" watchdog stop "merged mount or TCP 445 remained available"
    return 20
  fi
  quarantine_spike "$reason"
  append_safety_event "$evidence" watchdog fail-closed "Samba and merged namespace withdrawn"
  return 10
}

run_watchdog() {
  read_state
  if [[ "$state_phase" == "stopped" ]]; then
    echo "Gate 1 watchdog requires a live or quarantined disposable spike" >&2
    return 1
  fi
  local evidence="$evidence_dir/watchdog-${spike_id}-$(date -u +%Y%m%dT%H%M%SZ).jsonl"
  if [[ -e "$evidence" || -L "$evidence" ]]; then
    echo "Refusing to overwrite Gate 1 watchdog evidence" >&2
    exit 1
  fi
  (set -o noclobber; : > "$evidence")
  chmod 600 "$evidence"
  local result
  set +e
  watchdog_once "$evidence"
  result=$?
  set -e
  if (( result == 0 )); then
    jq -n --arg evidence "$evidence" \
      '{watchdogHealthy:true,failClosedTriggered:false,gate1Passed:false,evidence:$evidence}'
    return
  fi
  if (( result == 10 )); then
    jq -n --arg evidence "$evidence" \
      '{watchdogHealthy:false,failClosedTriggered:true,stop:true,gate1Passed:false,evidence:$evidence}'
    return 10
  fi
  jq -n --arg evidence "$evidence" \
    '{watchdogHealthy:false,failClosedTriggered:false,stop:true,gate1Passed:false,evidence:$evidence}'
  return 20
}

run_branch_loss_test() {
  validate_live_spike
  if [[ "$state_phase" != "prepared" ]]; then
    echo "Branch-loss test requires prepared phase with Samba stopped" >&2
    exit 1
  fi
  if ss -H -ltn 'sport = :445' | grep -q .; then
    echo "Branch-loss test refuses to run while TCP 445 is active" >&2
    exit 1
  fi

  local evidence="$evidence_dir/branch-loss-${spike_id}.jsonl"
  local root_hash ssd_hash hdd_hash native_fail_closed=false watchdog_result restored=false
  if [[ -e "$evidence" || -L "$evidence" ]]; then
    echo "Refusing to overwrite Gate 1 branch-loss evidence" >&2
    exit 1
  fi
  (set -o noclobber; : > "$evidence")
  chmod 600 "$evidence"
  root_hash="$(sha256sum "$root_marker" | awk '{print $1}')"
  ssd_hash="$(sha256sum "$ssd_mount/.denizcloud-gate1-branch.json" | awk '{print $1}')"
  hdd_hash="$(sha256sum "$hdd_mount/.denizcloud-gate1-branch.json" | awk '{print $1}')"
  append_safety_event "$evidence" branch-loss start "exact marker hashes captured"

  recover_branch_loss_test() {
    set +e
    if [[ "$restored" != "true" ]] \
      && ! mountpoint -q "$hdd_mount" \
      && loop_backing_is "$hdd_loop" "$hdd_image"; then
      timeout --kill-after=2s "$watchdog_timeout_seconds" mount -o noatime,nodev,nosuid "$hdd_loop" "$hdd_mount"
    fi
    # A failed proof stays quarantined with the merged namespace withdrawn.
    # Restoring the branch prevents a lingering partial source without masking
    # the STOP result by republishing the union.
  }
  trap recover_branch_loss_test EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  mount_source_is "$hdd_mount" "$hdd_loop" || { echo "HDD mount source mismatch before branch-loss simulation" >&2; exit 1; }
  loop_backing_is "$hdd_loop" "$hdd_image" || { echo "HDD loop backing mismatch before branch-loss simulation" >&2; exit 1; }
  timeout --kill-after=2s "$watchdog_timeout_seconds" umount "$hdd_mount"
  if ! mountpoint -q "$merged_mount"; then
    native_fail_closed=true
  fi
  append_safety_event "$evidence" mergerfs-native observed "nativeFailClosed=${native_fail_closed}"

  set +e
  watchdog_once "$evidence"
  watchdog_result=$?
  set -e
  if (( watchdog_result != 10 )); then
    append_safety_event "$evidence" branch-loss stop "watchdog did not prove fail-closed withdrawal"
    jq -n --arg evidence "$evidence" --argjson watchdogResult "$watchdog_result" \
      '{branchLossWatchdogPassed:false,stop:true,gate1Passed:false,watchdogResult:$watchdogResult,evidence:$evidence}'
    return 20
  fi

  timeout --kill-after=2s "$watchdog_timeout_seconds" mount -o noatime,nodev,nosuid "$hdd_loop" "$hdd_mount"
  mount_source_is "$hdd_mount" "$hdd_loop" || { echo "STOP: restored HDD mount source mismatch" >&2; return 20; }
  branch_marker_is "$hdd_mount" hdd || { echo "STOP: restored HDD branch marker mismatch" >&2; return 20; }
  [[ "$(sha256sum "$root_marker" | awk '{print $1}')" == "$root_hash" ]] || { echo "STOP: root marker changed" >&2; return 20; }
  [[ "$(sha256sum "$ssd_mount/.denizcloud-gate1-branch.json" | awk '{print $1}')" == "$ssd_hash" ]] || { echo "STOP: SSD marker changed" >&2; return 20; }
  [[ "$(sha256sum "$hdd_mount/.denizcloud-gate1-branch.json" | awk '{print $1}')" == "$hdd_hash" ]] || { echo "STOP: HDD marker changed" >&2; return 20; }
  mount_disposable_union || { echo "STOP: merged namespace did not recover" >&2; return 20; }
  [[ -r "$probe_root/.posix-gate1-disposable" ]] || { echo "STOP: disposable namespace marker did not recover" >&2; return 20; }
  jq --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.phase="prepared" | .safety={status:"recovered-after-test",at:$at,gate1Passed:false}' \
    "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  state_phase="prepared"
  append_safety_event "$evidence" branch-loss pass "watchdog withdrew and exact markers survived recovery"
  restored=true
  trap - EXIT HUP INT TERM
  jq -n \
    --arg evidence "$evidence" \
    --argjson nativeFailClosed "$native_fail_closed" \
    '{branchLossWatchdogPassed:true,nativeMergerfsFailClosed:$nativeFailClosed,externalWatchdogFailClosed:true,markersPreserved:true,recovered:true,gate1Passed:false,evidence:$evidence}'
}

run_reboot_check() {
  read_state
  local saved_boot_id current_boot_id exact_smbd_running=false resources_absent=true
  saved_boot_id="$(jq -r '.bootId // "missing"' "$state_file")"
  current_boot_id="$(cat /proc/sys/kernel/random/boot_id)"
  if [[ "$saved_boot_id" == "$current_boot_id" || "$saved_boot_id" == "missing" ]]; then
    jq -n --arg savedBootId "$saved_boot_id" --arg currentBootId "$current_boot_id" \
      '{rebootObserved:false,rebootSafetyPassed:false,stop:true,gate1Passed:false,savedBootId:$savedBootId,currentBootId:$currentBootId}'
    return 10
  fi
  if mountpoint -q "$merged_mount" || mountpoint -q "$ssd_mount" || mountpoint -q "$hdd_mount" \
    || losetup -j "$ssd_image" | grep -q . || losetup -j "$hdd_image" | grep -q . \
    || nft list table inet "$firewall_table" >/dev/null 2>&1; then
    resources_absent=false
  fi
  local expected_config="$samba_root/smb.conf" process_cmdline
  for process_cmdline in /proc/[0-9]*/cmdline; do
    if [[ -r "$process_cmdline" ]] && tr '\0' '\n' < "$process_cmdline" | grep -Fxq -- "$expected_config"; then
      exact_smbd_running=true
      break
    fi
  done
  if [[ "$resources_absent" != "true" || "$exact_smbd_running" == "true" ]]; then
    jq -n --argjson resourcesAbsent "$resources_absent" --argjson exactSmbdRunning "$exact_smbd_running" \
      '{rebootObserved:true,rebootSafetyPassed:false,stop:true,gate1Passed:false,resourcesAbsent:$resourcesAbsent,exactDisposableSmbdRunning:$exactSmbdRunning}'
    return 20
  fi
  jq --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '.phase="quarantined" | .safety={status:"reboot-fail-closed-unverified-markers",at:$at,gate1Passed:false}' \
    "$state_file" > "$state_file.partial"
  mv "$state_file.partial" "$state_file"
  chmod 600 "$state_file"
  find "$samba_root/client.auth" -maxdepth 0 -type f -delete 2>/dev/null || true
  jq -n '{rebootObserved:true,rebootFailClosedObserved:true,rebootSafetyPassed:false,resourcesAbsent:true,exactDisposableSmbdRunning:false,branchMarkersRequireRemountVerification:true,stop:true,gate1Passed:false}'
  return 10
}

show_status() {
  if [[ ! -e "$state_root" ]]; then
    jq -n --arg root "$state_root" '{present:false,root:$root}'
    return
  fi
  read_state
  local tcp445=false merged=false ssd=false hdd=false firewall_state=absent
  ss -H -ltn 'sport = :445' | grep -q . && tcp445=true
  mountpoint -q "$merged_mount" && merged=true
  mountpoint -q "$ssd_mount" && ssd=true
  mountpoint -q "$hdd_mount" && hdd=true
  if nft list table inet "$firewall_table" >/dev/null 2>&1; then
    if firewall_is_current_spike; then
      firewall_state=current
    else
      firewall_state=foreign
    fi
  fi
  jq -n --arg phase "$state_phase" --arg spikeId "$spike_id" \
    --argjson tcp445 "$tcp445" --argjson merged "$merged" --argjson ssd "$ssd" --argjson hdd "$hdd" --arg firewallState "$firewall_state" \
    '{present:true,phase:$phase,spikeId:$spikeId,tcp445Listening:$tcp445,firewallState:$firewallState,mounts:{merged:$merged,ssdLoop:$ssd,hddLoop:$hdd}}'
}

stop_spike() {
  read_state
  if [[ "$state_phase" == "stopped" ]]; then
    if mountpoint -q "$merged_mount" || mountpoint -q "$ssd_mount" || mountpoint -q "$hdd_mount" \
      || losetup -j "$ssd_image" | grep -q . || losetup -j "$hdd_image" | grep -q . \
      || ss -H -ltn 'sport = :445' | grep -q .; then
      echo "Stopped state disagrees with live Gate 1 resources" >&2
      exit 1
    fi
    if nft list table inet "$firewall_table" >/dev/null 2>&1; then
      remove_gate1_firewall || { echo "Stopped state has a foreign Gate 1 firewall" >&2; exit 1; }
    fi
    jq -n --arg spikeId "$spike_id" '{stopped:true,alreadyStopped:true,spikeId:$spikeId,tcp445Listening:false,mountsRemoved:true}'
    return
  fi
  if [[ "$state_phase" != "stopped" ]]; then
    loop_backing_is "$ssd_loop" "$ssd_image" || { echo "SSD loop backing mismatch" >&2; exit 1; }
    loop_backing_is "$hdd_loop" "$hdd_image" || { echo "HDD loop backing mismatch" >&2; exit 1; }
  fi
  stop_verified_samba_for_watchdog || exit 1
  if mountpoint -q "$merged_mount"; then umount "$merged_mount"; fi
  mount_source_is "$ssd_mount" "$ssd_loop" || { echo "SSD mount source mismatch before stop" >&2; exit 1; }
  mount_source_is "$hdd_mount" "$hdd_loop" || { echo "HDD mount source mismatch before stop" >&2; exit 1; }
  umount "$ssd_mount"
  umount "$hdd_mount"
  loop_backing_is "$ssd_loop" "$ssd_image" || { echo "SSD loop backing mismatch before detach" >&2; exit 1; }
  loop_backing_is "$hdd_loop" "$hdd_image" || { echo "HDD loop backing mismatch before detach" >&2; exit 1; }
  losetup -d "$ssd_loop"
  losetup -d "$hdd_loop"
  if mountpoint -q "$merged_mount" || mountpoint -q "$ssd_mount" || mountpoint -q "$hdd_mount" \
    || losetup -j "$ssd_image" | grep -q . || losetup -j "$hdd_image" | grep -q .; then
    echo "Gate 1 mounts or loops remain after stop" >&2
    exit 1
  fi
  [[ -f "$samba_root/client.auth" && ! -L "$samba_root/client.auth" ]] && find "$samba_root/client.auth" -delete
  update_phase stopped
  jq -n --arg spikeId "$spike_id" '{stopped:true,spikeId:$spikeId,tcp445Listening:false,mountsRemoved:true}'
}

destroy_spike() {
  read_state
  if [[ "$state_phase" != "stopped" ]]; then
    echo "Stop the disposable spike before destroying its files" >&2
    exit 1
  fi
  for target in "$merged_mount" "$ssd_mount" "$hdd_mount"; do
    if mountpoint -q "$target"; then
      echo "Refusing destroy while a Gate 1 mount remains: ${target}" >&2
      exit 1
    fi
  done
  if losetup -j "$ssd_image" | grep -q . || losetup -j "$hdd_image" | grep -q .; then
    echo "Refusing destroy while a Gate 1 loop remains attached" >&2
    exit 1
  fi
  if ss -H -ltn 'sport = :445' | grep -q .; then
    echo "Refusing destroy while TCP 445 has a listener" >&2
    exit 1
  fi
  if nft list table inet "$firewall_table" >/dev/null 2>&1; then
    remove_gate1_firewall || {
      echo "Refusing destroy with a foreign Gate 1 firewall" >&2
      exit 1
    }
  fi
  if [[ "$(realpath -e "$state_root")" != "$state_root" || -L "$state_root" || "$(jq -er '.spikeId' "$root_marker")" != "$spike_id" ]]; then
    echo "Gate 1 destroy marker validation failed" >&2
    exit 1
  fi
  find "$state_root" -xdev -depth -delete
  jq -n --arg spikeId "$spike_id" '{destroyed:true,spikeId:$spikeId,recoverable:false}'
}

case "$action" in
  prepare) prepare_spike ;;
  start-samba) start_samba ;;
  status) show_status ;;
  host-test) run_host_tests ;;
  api-test) run_api_tests ;;
  watchdog) run_watchdog ;;
  branch-loss-test) run_branch_loss_test ;;
  reboot-check) run_reboot_check ;;
  stop) stop_spike ;;
  destroy) destroy_spike ;;
esac
