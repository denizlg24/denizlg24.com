#!/bin/bash

set -euo pipefail
set +x

umask 077

mode="--dry-run"
if (( $# > 1 )); then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi
if (( $# == 1 )); then mode="$1"; fi
if [[ "$mode" != "--dry-run" && "$mode" != "--execute" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi

state_root="${POSIX_GATE1_ROOT:-/var/lib/deniz-cloud/posix-gate1}"
if [[ "$state_root" != /* || "$state_root" == *//* || "$state_root" == */./* || "$state_root" == */../* ]]; then
  echo "Gate 1 root must be a normalized absolute path" >&2
  exit 1
fi
if [[ "$state_root" == "/" || ! "$(basename "$state_root")" =~ ^posix-gate1([._-][A-Za-z0-9_-]+)?$ ]]; then
  echo "Gate 1 root must be specifically named" >&2
  exit 1
fi
for protected_root in /data/hdd /data/ssd /mnt/hdd/storage /mnt/ssd/storage /mnt/hdd/deniz-cloud/namespace /mnt/ssd/deniz-cloud/namespace /opt/deniz-cloud /srv/deniz-cloud; do
  if [[ "$state_root" == "$protected_root" || "$state_root" == "$protected_root"/* || "$protected_root" == "$state_root"/* ]]; then
    echo "Gate 1 root overlaps a protected production path" >&2
    exit 1
  fi
done

state_file="$state_root/state.json"
root_marker="$state_root/.posix-gate1-root.json"
ssd_image="$state_root/images/ssd.ext4"
hdd_image="$state_root/images/hdd.ext4"
ssd_mount="$state_root/mounts/ssd"
hdd_mount="$state_root/mounts/hdd"
merged_mount="$state_root/mounts/merged"
ssd_branch="$ssd_mount/namespace"
hdd_branch="$hdd_mount/namespace"
evidence_dir="$state_root/evidence"

if [[ "$mode" == "--dry-run" ]]; then
  jq -n --arg mode "$mode" --arg root "$state_root" \
    '{mode:$mode,root:$root,writes:false,productionBranchesMounted:false,gate1Passed:false,checks:["copy interrupted","destination fsynced","destination published","source unlinked","reverse promotion"]}'
  exit 0
fi
if (( EUID != 0 )); then
  echo "Tier crash probing requires root" >&2
  exit 1
fi
for command in basename cat chmod chown cp cut date dd dirname find findmnt getfattr jq losetup mkdir mountpoint mv readlink realpath runuser setfattr sha256sum stat sync; do
  command -v "$command" >/dev/null || { echo "Required command is missing: ${command}" >&2; exit 1; }
done
if [[ ! -f "$state_file" || -L "$state_file" || ! -f "$root_marker" || -L "$root_marker" ]]; then
  echo "Gate 1 state is missing or unsafe" >&2
  exit 1
fi

phase="$(jq -er '.phase' "$state_file")"
spike_id="$(jq -er '.spikeId' "$state_file")"
ssd_loop="$(jq -er '.loops.ssd' "$state_file")"
hdd_loop="$(jq -er '.loops.hdd' "$state_file")"
if [[ ! "$phase" =~ ^(prepared|samba)$ || ! "$spike_id" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "Gate 1 state is not in a testable phase" >&2
  exit 1
fi
if [[ "$(jq -er '.root' "$root_marker")" != "$state_root" || "$(jq -er '.spikeId' "$root_marker")" != "$spike_id" ]]; then
  echo "Gate 1 root marker mismatch" >&2
  exit 1
fi
if [[ "$(readlink -f "$(losetup -n -O BACK-FILE "$ssd_loop")")" != "$(realpath -e "$ssd_image")" \
  || "$(readlink -f "$(losetup -n -O BACK-FILE "$hdd_loop")")" != "$(realpath -e "$hdd_image")" ]]; then
  echo "Gate 1 loop backing mismatch" >&2
  exit 1
fi
if [[ "$(findmnt -n -o SOURCE --target "$ssd_mount")" != "$ssd_loop" \
  || "$(findmnt -n -o SOURCE --target "$hdd_mount")" != "$hdd_loop" \
  || "$(findmnt -n -o FSTYPE --target "$merged_mount")" != "fuse.mergerfs" \
  || "$(findmnt -n -o SOURCE --target "$merged_mount")" != "deniz-cloud-gate1" ]]; then
  echo "Gate 1 mount identity mismatch" >&2
  exit 1
fi
for role_mount in "$ssd_mount:ssd" "$hdd_mount:hdd"; do
  branch_mount="${role_mount%%:*}"
  branch_role="${role_mount##*:}"
  marker="$branch_mount/.denizcloud-gate1-branch.json"
  if [[ ! -f "$marker" || -L "$marker" \
    || "$(jq -er '.spikeId' "$marker")" != "$spike_id" \
    || "$(jq -er '.role' "$marker")" != "$branch_role" ]]; then
    echo "Gate 1 branch marker mismatch" >&2
    exit 1
  fi
done

owner="$(stat -c '%U' "$ssd_branch")"
if [[ ! "$owner" =~ ^[a-z_][a-z0-9_-]*$ || "$(stat -c '%u' "$ssd_branch")" != "1000" ]]; then
  echo "Disposable namespace owner mismatch" >&2
  exit 1
fi

relative_dir="personal/.tier-crash-${spike_id}"
ssd_test="$ssd_branch/$relative_dir"
hdd_test="$hdd_branch/$relative_dir"
merged_test="$merged_mount/$relative_dir"
ssd_internal="$ssd_mount/internal/tiering-$spike_id"
hdd_internal="$hdd_mount/internal/tiering-$spike_id"
source_file="$ssd_test/payload.bin"
merged_file="$merged_test/payload.bin"
hdd_file="$hdd_test/payload.bin"
ssd_file="$ssd_test/payload.bin"
evidence="$evidence_dir/tier-crash-${spike_id}.jsonl"

for path in "$ssd_test" "$hdd_test" "$ssd_internal" "$hdd_internal" "$evidence"; do
  if [[ -e "$path" || -L "$path" ]]; then
    echo "Refusing to reuse Gate 1 tier-crash state" >&2
    exit 1
  fi
done

ssd_created=false
hdd_created=false
ssd_internal_created=false
hdd_internal_created=false
cleanup() {
  set +e
  if [[ "$ssd_created" == "true" && "$ssd_test" == "$ssd_branch/personal/.tier-crash-$spike_id" \
    && -f "$ssd_test/.posix-gate1-tier-crash" \
    && "$(<"$ssd_test/.posix-gate1-tier-crash")" == "$spike_id" ]]; then
    find "$ssd_test" -xdev -depth -delete
  fi
  if [[ "$hdd_created" == "true" && "$hdd_test" == "$hdd_branch/personal/.tier-crash-$spike_id" \
    && -f "$hdd_test/.posix-gate1-tier-crash" \
    && "$(<"$hdd_test/.posix-gate1-tier-crash")" == "$spike_id" ]]; then
    find "$hdd_test" -xdev -depth -delete
  fi
  if [[ "$ssd_internal_created" == "true" && "$ssd_internal" == "$ssd_mount/internal/tiering-$spike_id" \
    && -f "$ssd_internal/.posix-gate1-tier-crash" ]]; then
    find "$ssd_internal" -xdev -depth -delete
  fi
  if [[ "$hdd_internal_created" == "true" && "$hdd_internal" == "$hdd_mount/internal/tiering-$spike_id" \
    && -f "$hdd_internal/.posix-gate1-tier-crash" ]]; then
    find "$hdd_internal" -xdev -depth -delete
  fi
}
trap cleanup EXIT HUP INT TERM

mkdir -m 700 "$ssd_internal" "$hdd_internal"
ssd_internal_created=true
hdd_internal_created=true
printf '%s\n' "$spike_id" > "$ssd_internal/.posix-gate1-tier-crash"
printf '%s\n' "$spike_id" > "$hdd_internal/.posix-gate1-tier-crash"
mkdir -m 700 "$ssd_test"
ssd_created=true
printf '%s\n' "$spike_id" > "$ssd_test/.posix-gate1-tier-crash"
chown -R 1000:1000 "$ssd_test"
runuser -u "$owner" -- dd if=/dev/urandom of="$source_file" bs=1M count=4 status=none
stable_id="$(cat /proc/sys/kernel/random/uuid)"
setfattr -n user.denizcloud.id -v "$stable_id" "$source_file"
sync -f "$source_file"
sync -f "$ssd_test"
expected_hash="$(sha256sum "$source_file" | cut -d' ' -f1)"

record() {
  jq -nc --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg event "$1" --arg hash "$expected_hash" --arg id "$stable_id" \
    '{schemaVersion:1,at:$at,event:$event,status:"pass",sha256:$hash,stableId:$id}' >> "$evidence"
}

# Crash while copying: the partial destination lives outside the merged branch.
partial="$hdd_internal/partial.stage"
dd if="$source_file" of="$partial" bs=1M count=1 status=none
sync -f "$partial"
[[ "$(sha256sum "$merged_file" | cut -d' ' -f1)" == "$expected_hash" && ! -e "$hdd_file" ]]
find "$partial" -maxdepth 0 -type f -delete
record copy-interrupted

# Crash after destination fsync: the complete stage is still unreachable.
stage="$hdd_internal/full.stage"
cp --preserve=all "$source_file" "$stage"
sync -f "$stage"
[[ "$(sha256sum "$stage" | cut -d' ' -f1)" == "$expected_hash" \
  && "$(getfattr --only-values -n user.denizcloud.id "$stage")" == "$stable_id" \
  && "$(sha256sum "$merged_file" | cut -d' ' -f1)" == "$expected_hash" ]]
record destination-fsynced

# Crash after publish but before source unlink: both physical copies agree and
# the merged namespace returns the same verified generation.
mkdir -m 700 "$hdd_test"
hdd_created=true
printf '%s\n' "$spike_id" > "$hdd_test/.posix-gate1-tier-crash"
chown -R 1000:1000 "$hdd_test"
mv "$stage" "$hdd_file"
sync -f "$hdd_test"
[[ "$(sha256sum "$ssd_file" | cut -d' ' -f1)" == "$expected_hash" \
  && "$(sha256sum "$hdd_file" | cut -d' ' -f1)" == "$expected_hash" \
  && "$(sha256sum "$merged_file" | cut -d' ' -f1)" == "$expected_hash" \
  && "$(getfattr --only-values -n user.denizcloud.id "$hdd_file")" == "$stable_id" ]]
record destination-published

# Recovery may remove the agreeing source only after verifying both copies.
find "$ssd_file" -maxdepth 0 -type f -delete
sync -f "$ssd_test"
[[ ! -e "$ssd_file" && "$(sha256sum "$merged_file" | cut -d' ' -f1)" == "$expected_hash" \
  && "$(getfattr --only-values -n user.denizcloud.id "$merged_file")" == "$stable_id" ]]
record source-unlinked

# Reverse promotion uses the SSD's internal staging area and remains exact.
promotion="$ssd_internal/promotion.stage"
cp --preserve=all "$hdd_file" "$promotion"
sync -f "$promotion"
mv "$promotion" "$ssd_file"
sync -f "$ssd_test"
[[ "$(sha256sum "$merged_file" | cut -d' ' -f1)" == "$expected_hash" ]]
find "$hdd_file" -maxdepth 0 -type f -delete
sync -f "$hdd_test"
[[ "$(sha256sum "$merged_file" | cut -d' ' -f1)" == "$expected_hash" \
  && "$(getfattr --only-values -n user.denizcloud.id "$merged_file")" == "$stable_id" ]]
record reverse-promotion

trap - EXIT HUP INT TERM
cleanup
jq -n --arg evidence "$evidence" --arg hash "$expected_hash" --arg stableId "$stable_id" \
  '{partialTierCrashTestsPassed:true,gate1Passed:false,evidence:$evidence,sha256:$hash,stableId:$stableId,pending:["actual reboot during copy","production tier recovery implementation"]}'
