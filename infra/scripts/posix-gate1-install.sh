#!/bin/bash

set -euo pipefail

umask 077

mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--execute" ]]; then
  echo "Usage: $0 [--dry-run|--execute]" >&2
  exit 2
fi

readonly mergerfs_version="2.42.0"
readonly mergerfs_url="https://github.com/trapexit/mergerfs/releases/download/2.42.0/mergerfs_2.42.0.ubuntu-noble_arm64.deb"
readonly mergerfs_sha256="114bbb6b7a83248e2784679eb43533ad91a976373862e8e6530b0696e262be88"
readonly -a samba_units=(smbd.service nmbd.service samba-ad-dc.service)
readonly -a packages=(acl attr curl e2fsprogs fio fuse3 jq samba smbclient util-linux)

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify the operating system" >&2
  exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
architecture="$(dpkg --print-architecture 2>/dev/null || true)"

jq -n \
  --arg mode "$mode" \
  --arg osId "${ID:-unknown}" \
  --arg osVersion "${VERSION_ID:-unknown}" \
  --arg codename "${VERSION_CODENAME:-unknown}" \
  --arg architecture "$architecture" \
  --arg mergerfsVersion "$mergerfs_version" \
  --arg mergerfsUrl "$mergerfs_url" \
  --arg mergerfsSha256 "$mergerfs_sha256" \
  --argjson packages "$(printf '%s\n' "${packages[@]}" | jq -R . | jq -s .)" \
  '{mode:$mode,host:{os:$osId,version:$osVersion,codename:$codename,architecture:$architecture},mergerfs:{version:$mergerfsVersion,url:$mergerfsUrl,sha256:$mergerfsSha256},packages:$packages,sambaUnitsRemainMasked:true}'

if [[ "$mode" == "--dry-run" ]]; then
  exit 0
fi
if (( EUID != 0 )); then
  echo "Installation requires root" >&2
  exit 1
fi
if [[ "${ID:-}" != "ubuntu" || "${VERSION_CODENAME:-}" != "noble" || "$architecture" != "arm64" ]]; then
  echo "Gate 1 packages are pinned for Ubuntu Noble arm64, not ${ID:-unknown}/${VERSION_CODENAME:-unknown}/${architecture:-unknown}" >&2
  exit 1
fi
for command in apt-get curl dpkg jq sha256sum ss systemctl; do
  if ! command -v "$command" >/dev/null; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done
if ss -H -ltn 'sport = :445' | grep -q .; then
  echo "Refusing installation while TCP 445 already has a listener" >&2
  exit 1
fi

download_dir="$(mktemp -d /tmp/posix-gate1-install.XXXXXX)"
cleanup() {
  set +e
  if [[ -n "${download_dir:-}" && "$download_dir" == /tmp/posix-gate1-install.* && -d "$download_dir" ]]; then
    find "$download_dir" -xdev -depth -delete
  fi
}
trap cleanup EXIT HUP INT TERM

deb_path="$download_dir/mergerfs.deb"
curl --fail --location --proto '=https' --tlsv1.2 \
  --output "$deb_path" "$mergerfs_url"
printf '%s  %s\n' "$mergerfs_sha256" "$deb_path" | sha256sum -c -

apt-get update
simulation_output="$(mktemp "$download_dir/apt-simulation.XXXXXX")"
if ! DEBIAN_FRONTEND=noninteractive apt-get --simulate install -y \
  "${packages[@]}" "$deb_path" >"$simulation_output" 2>&1; then
  cat "$simulation_output" >&2
  if grep -Eq 'libacl1|libattr1' "$simulation_output"; then
    cat >&2 <<'EOF'
Gate 1 package installation is blocked by inconsistent Ubuntu package sources.
On Ubuntu Noble, make sure noble-updates is enabled, run apt-get update, and
rerun this installer. Do not downgrade libacl1 or libattr1 to work around it.
EOF
  fi
  exit 1
fi

# Package post-install hooks must never start a default file server. Mask only
# after APT has proved the complete transaction is resolvable. The masks remain
# in place after the disposable spike; Checkpoint 5 owns any production unmask
# and service enablement.
systemctl mask --now "${samba_units[@]}"

DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}" "$deb_path"
systemctl mask --now "${samba_units[@]}"

installed_mergerfs="$(mergerfs --version | awk 'NR == 1 {print $NF}')"
installed_samba="$(smbd --version | awk 'NR == 1 {print $2}')"
if [[ "$installed_mergerfs" != "$mergerfs_version" ]]; then
  echo "Expected mergerfs ${mergerfs_version}, installed ${installed_mergerfs}" >&2
  exit 1
fi
for unit in "${samba_units[@]}"; do
  if [[ "$(systemctl is-enabled "$unit" 2>/dev/null || true)" != "masked" ]]; then
    echo "Samba unit is not masked: ${unit}" >&2
    exit 1
  fi
done
if ss -H -ltn 'sport = :445' | grep -q .; then
  echo "TCP 445 unexpectedly became active during installation" >&2
  exit 1
fi

jq -n \
  --arg mergerfs "$installed_mergerfs" \
  --arg samba "$installed_samba" \
  '{installed:true,mergerfs:$mergerfs,samba:$samba,sambaUnitsMasked:true,tcp445Listening:false}'
