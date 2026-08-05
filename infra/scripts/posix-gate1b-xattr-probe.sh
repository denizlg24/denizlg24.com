#!/bin/bash
# Disposable Gate 1B probe: can security.* carry protected metadata end to end?
# Touches nothing outside its own root. No production path is referenced.
set -uo pipefail

root=${POSIX_PROBE_ROOT:-/var/tmp/posix-xattr-probe}
unpriv=${POSIX_PROBE_UNPRIVILEGED_USER:-denizlg24}
ns_user=user.denizcloud.id
ns_sec=security.denizcloud.id
value=4c16d776-6f9d-4f13-9b14-30821b8b94cd
result() { printf '%-46s %s\n' "$1" "$2"; }
ok() { result "$1" "PASS"; }
no() { result "$1" "FAIL"; }

cleanup() {
  mountpoint -q "$root/merged" && fusermount3 -u "$root/merged" 2>/dev/null
  for b in ssd hdd; do mountpoint -q "$root/$b" && umount "$root/$b" 2>/dev/null; done
  losetup -j "$root/ssd.img" 2>/dev/null | cut -d: -f1 | xargs -r losetup -d 2>/dev/null
  losetup -j "$root/hdd.img" 2>/dev/null | cut -d: -f1 | xargs -r losetup -d 2>/dev/null
  rm -rf "$root"
}
trap cleanup EXIT

rm -rf "$root"; mkdir -p "$root"/{ssd,hdd,merged,restore}
for b in ssd hdd; do
  truncate -s 512M "$root/$b.img"
  mkfs.ext4 -q -F "$root/$b.img"
  mount -o loop,user_xattr "$root/$b.img" "$root/$b"
done
echo "=== branch: ext4 direct ==="
f="$root/ssd/probe.bin"; echo payload > "$f"

setfattr -n "$ns_sec" -v "$value" -- "$f" 2>/dev/null \
  && [[ "$(getfattr --only-values -n "$ns_sec" -- "$f" 2>/dev/null)" == "$value" ]] \
  && ok "root sets+reads security.* on ext4" || no "root sets+reads security.* on ext4"

setfattr -n "$ns_user" -v "$value" -- "$f" >/dev/null 2>&1 \
  && ok "root sets user.* on ext4 (control)" || no "root sets user.* on ext4 (control)"

if sudo -u "$unpriv" setfattr -n "$ns_sec" -v tampered -- "$f" >/dev/null 2>&1; then
  no "unprivileged CANNOT write security.*"
else
  ok "unprivileged CANNOT write security.*"
fi
if sudo -u "$unpriv" setfattr -n "$ns_user" -v tampered -- "$f" >/dev/null 2>&1; then
  result "unprivileged CAN write user.* (the old hole)" "CONFIRMED-HOLE"
  setfattr -n "$ns_user" -v "$value" -- "$f" 2>/dev/null
else
  result "unprivileged write user.*" "denied-by-perms"
fi
readable=$(sudo -u "$unpriv" getfattr --only-values -n "$ns_sec" -- "$f" 2>/dev/null || echo "<denied>")
result "unprivileged read security.*" "$readable"

echo "=== mergerfs union ==="
# minfreespace must be set explicitly: mergerfs defaults to 4G, so on branches
# this small every create fails ENOSPC and reads as an xattr failure.
if mergerfs -o "allow_other,xattr=passthrough,minfreespace=8M,posix-acl=true,cache.files=off,category.create=ff,fsname=probe" \
    "$root/ssd:$root/hdd" "$root/merged" >/dev/null 2>&1; then
  ok "mergerfs mounted"
  m="$root/merged/probe.bin"
  [[ "$(getfattr --only-values -n "$ns_sec" -- "$m" 2>/dev/null)" == "$value" ]] \
    && ok "security.* READ through mergerfs" || no "security.* READ through mergerfs"
  echo new > "$root/merged/created.bin"
  setfattr -n "$ns_sec" -v "$value" -- "$root/merged/created.bin" 2>/dev/null \
    && [[ "$(getfattr --only-values -n "$ns_sec" -- "$root/merged/created.bin" 2>/dev/null)" == "$value" ]] \
    && ok "security.* WRITE through mergerfs" || no "security.* WRITE through mergerfs"
else
  no "mergerfs mounted"
fi

echo "=== preservation ==="
cp --preserve=all -- "$f" "$root/ssd/copy.bin" 2>/dev/null
[[ "$(getfattr --only-values -n "$ns_sec" -- "$root/ssd/copy.bin" 2>/dev/null)" == "$value" ]] \
  && ok "cp --preserve=all keeps security.*" || no "cp --preserve=all keeps security.*"

tar --xattrs --xattrs-include='*' -C "$root/ssd" -cf "$root/probe.tar" probe.bin 2>/dev/null
tar --xattrs --xattrs-include='*' -C "$root/restore" -xf "$root/probe.tar" 2>/dev/null
[[ "$(getfattr --only-values -n "$ns_sec" -- "$root/restore/probe.bin" 2>/dev/null)" == "$value" ]] \
  && ok "tar --xattrs round-trip keeps security.*" || no "tar --xattrs round-trip keeps security.*"

rm -rf "$root/restore"/*; rsync -aX "$f" "$root/restore/" >/dev/null 2>&1
[[ "$(getfattr --only-values -n "$ns_sec" -- "$root/restore/probe.bin" 2>/dev/null)" == "$value" ]] \
  && ok "rsync -aX keeps security.*" || no "rsync -aX keeps security.*"

echo "=== enumeration ==="
echo "root sees:        $(getfattr -d -m- -- "$f" 2>/dev/null | grep -c denizcloud) denizcloud xattr(s)"
echo "unprivileged sees: $(sudo -u "$unpriv" getfattr -d -m- -- "$f" 2>/dev/null | grep -c denizcloud) denizcloud xattr(s)"
