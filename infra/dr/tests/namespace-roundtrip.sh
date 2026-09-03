#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

((EUID == 0)) || { echo "namespace round-trip test requires root" >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || { echo "namespace round-trip test requires Linux" >&2; exit 1; }

root="$(cd "$(dirname "$0")/../../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/var/tmp}/dr-namespace-roundtrip.XXXXXX")"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT

for command in getfacl getfattr jq setfacl setfattr sha256sum stat tar truncate zstd; do
  command -v "$command" >/dev/null || { echo "missing test dependency: ${command}" >&2; exit 1; }
done

ssd="$work/source-ssd"
hdd="$work/source-hdd"
destination="$work/backups"
restored_ssd="$work/restored-ssd"
restored_hdd="$work/restored-hdd"
object_store="$work/source-object-store"
restored_object_store="$work/restored-object-store"
install -d -m 0700 "$ssd/folder with spaces" "$hdd/archive" "$object_store/bucket/objects" \
  "$destination" "$restored_ssd" "$restored_hdd" "$restored_object_store"
printf '{"schemaVersion":1,"branchId":"11111111-1111-4111-8111-111111111111","filesystemUuids":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}\n' \
  > "$ssd/.denizcloud-branch.json"
printf '{"schemaVersion":1,"branchId":"22222222-2222-4222-8222-222222222222","filesystemUuids":["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]}\n' \
  > "$hdd/.denizcloud-branch.json"
printf 'authoritative payload\n' > "$ssd/folder with spaces/document.txt"
printf 'project object payload\n' > "$object_store/bucket/objects/object.bin"
truncate -s 1048576 "$hdd/archive/sparse.bin"
printf x | dd of="$hdd/archive/sparse.bin" bs=1 seek=1048575 conv=notrunc status=none
setfattr -n user.denizcloud.roundtrip -v preserved -- "$ssd/folder with spaces/document.txt"
setfattr -n security.denizcloud.id -v 33333333-3333-4333-8333-333333333333 -- "$ssd/folder with spaces/document.txt"
setfacl -m u:daemon:r-- -- "$ssd/folder with spaces/document.txt"

result="$(
  POSIX_BACKUP_SSD_BRANCH="$ssd" \
  POSIX_BACKUP_HDD_BRANCH="$hdd" \
  POSIX_BACKUP_OBJECT_STORE="$object_store" \
  POSIX_BACKUP_DESTINATION="$destination" \
    "$root/infra/scripts/posix-namespace-backup.sh" --execute
)"
backup_dir="$(jq -er 'select(.backedUp==true and .manifestEntries==12 and .objectStoreIncluded==true) | .directory' <<< "$result")"
[[ "$backup_dir" == "$destination"/posix-namespace-* ]] || { echo "backup returned an unsafe path" >&2; exit 1; }

for pair in "ssd:$restored_ssd" "hdd:$restored_hdd" "object-store:$restored_object_store"; do
  branch="${pair%%:*}"
  restored="${pair#*:}"
  zstd -dc "$backup_dir/${branch}.tar.zst" \
    | tar --xattrs --xattrs-include='security.*' --xattrs-include='user.*' \
        --acls --numeric-owner --sparse -C "$restored" -xf -
done

verification="$("$root/infra/scripts/posix-namespace-restore-verify.sh" \
  --backup "$backup_dir" --ssd-root "$restored_ssd" --hdd-root "$restored_hdd" \
  --object-root "$restored_object_store")"
jq -e '.verified==true and .mismatches==0 and .entriesChecked==12 and .liveNamespaceTouched==false' \
  <<< "$verification" >/dev/null
[[ "$(getfattr --only-values -n user.denizcloud.roundtrip -- "$restored_ssd/folder with spaces/document.txt")" == preserved ]] \
  || { echo "user xattr did not survive namespace round trip" >&2; exit 1; }

printf 'Namespace backup disposable restore round-trip passed\n'
