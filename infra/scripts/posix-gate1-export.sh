#!/bin/bash

set -euo pipefail
umask 077

mode=--dry-run
mode_seen=false
for argument in "$@"; do
  case "$argument" in
    --dry-run|--execute)
      [[ "$mode_seen" == false ]] || { echo "Mode may be specified only once" >&2; exit 2; }
      mode=$argument; mode_seen=true ;;
    *) echo "Usage: $0 [--dry-run|--execute]" >&2; exit 2 ;;
  esac
done

root=${POSIX_GATE1_ROOT:-/var/lib/deniz-cloud/posix-gate1}
destination=${POSIX_GATE1_EXPORT_DIR:-/mnt/hdd/backups}
state=$root/state.json
root_marker=$root/.posix-gate1-root.json

[[ "$root" == /var/lib/deniz-cloud/posix-gate1 ]] || { echo "Refusing an unexpected Gate 1 root" >&2; exit 1; }
[[ "$destination" == /mnt/hdd/backups ]] || { echo "Refusing an unexpected export directory" >&2; exit 1; }

spike_id=""
phase="absent"
if [[ -f "$state" && ! -L "$state" && -f "$root_marker" && ! -L "$root_marker" ]]; then
  spike_id=$(jq -er '.spikeId' "$state")
  phase=$(jq -er '.phase' "$state")
  [[ "$spike_id" =~ ^[0-9a-f-]{36}$ && "$(jq -er '.spikeId' "$root_marker")" == "$spike_id" ]] || { echo "Gate 1 markers mismatch" >&2; exit 1; }
fi

if [[ "$mode" == --dry-run ]]; then
  jq -n --arg mode "$mode" --arg root "$root" --arg destination "$destination" --arg spikeId "$spike_id" --arg phase "$phase" '{mode:$mode,root:$root,destination:$destination,spikeId:(if $spikeId=="" then null else $spikeId end),phase:$phase,writes:false,stopsGate1:false,destroysGate1:false,includesCredentials:false}'
  exit 0
fi
(( EUID == 0 )) || { echo "Execute mode requires root" >&2; exit 1; }
# Checked before anything is written, so a missing compressor fails the export
# rather than leaving a half-built directory behind.
for command in sha256sum tar zstd; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
[[ "$spike_id" != "" ]] || { echo "Gate 1 state is absent" >&2; exit 1; }
[[ "$phase" =~ ^(prepared|starting|samba|quarantined|stopped)$ ]] || { echo "Invalid Gate 1 phase" >&2; exit 1; }
[[ -d "$root/evidence" && ! -L "$root/evidence" ]] || { echo "Gate 1 evidence is missing or unsafe" >&2; exit 1; }
[[ -z "$(find "$root/evidence" -type l -print -quit)" ]] || { echo "Refusing symlinks in Gate 1 evidence" >&2; exit 1; }
install -d -m 0700 "$destination"
timestamp=$(date --utc +%Y%m%dT%H%M%SZ)
archive="$destination/posix-gate1-evidence-${spike_id}-${timestamp}.tar.zst"
[[ ! -e "$archive" && ! -L "$archive" ]] || { echo "Refusing to overwrite Gate 1 export" >&2; exit 1; }
work=$(mktemp -d "$destination/.posix-gate1-export.XXXXXX")
cleanup() {
  [[ "$work" == "$destination/.posix-gate1-export."* ]] && rm -rf -- "$work"
  [[ "$archive" == "$destination/posix-gate1-evidence-"* ]] && rm -f -- "$archive.partial"
}
trap cleanup EXIT
install -d -m 0700 "$work/snapshot/evidence" "$work/snapshot/markers" "$work/snapshot/runtime"
cp -a --no-dereference "$root/evidence/." "$work/snapshot/evidence/"
cp -a --no-dereference "$state" "$root_marker" "$work/snapshot/markers/"
for marker in "$root/mounts/ssd/.denizcloud-gate1-branch.json" "$root/mounts/hdd/.denizcloud-gate1-branch.json"; do
  [[ -f "$marker" && ! -L "$marker" ]] && cp -a --no-dereference "$marker" "$work/snapshot/markers/$(basename "$(dirname "$marker")")-branch.json"
done
# These copies are optional. Without the trailing `|| true` a missing file
# makes the whole export exit under set -e, which is the opposite of optional.
if [[ -f "$root/samba/smb.conf" && ! -L "$root/samba/smb.conf" ]]; then
  cp -a --no-dereference "$root/samba/smb.conf" "$work/snapshot/runtime/"
fi
if [[ -f "$root/samba/encryption-status.json" && ! -L "$root/samba/encryption-status.json" ]]; then
  cp -a --no-dereference "$root/samba/encryption-status.json" "$work/snapshot/runtime/"
fi
findmnt -J > "$work/snapshot/runtime/findmnt.json"
smbstatus --json > "$work/snapshot/runtime/smbstatus.json" 2>/dev/null || printf '{}\n' > "$work/snapshot/runtime/smbstatus.json"
ss -H -ltnp 'sport = :445' > "$work/snapshot/runtime/tcp445.txt" || true
jq -n --arg at "$(date --utc +%FT%TZ)" --arg spikeId "$spike_id" --arg phase "$phase" '{schemaVersion:1,exportedAt:$at,spikeId:$spikeId,phase:$phase,credentialsIncluded:false,gate1Stopped:false,gate1Destroyed:false}' > "$work/snapshot/export.json"
# The manifest is excluded from its own listing: `find` would otherwise race
# the redirection and hash a partially written manifest, or include it with a
# checksum that can never verify.
(cd "$work/snapshot" && find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 sha256sum > manifest.sha256)
tar --sort=name --numeric-owner --owner=0 --group=0 -C "$work" -cf - snapshot | zstd -T0 -19 -o "$archive.partial"
mv "$archive.partial" "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 0600 "$archive" "$archive.sha256"
jq -n --arg archive "$archive" --arg sha256 "$(sha256sum "$archive" | awk '{print $1}')" --arg spikeId "$spike_id" '{exported:true,archive:$archive,sha256:$sha256,spikeId:$spikeId,stopped:false,destroyed:false,next:"verify archive, then explicitly stop and destroy Gate 1"}'
