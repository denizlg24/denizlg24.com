#!/bin/bash

set -euo pipefail
umask 077

mode=--dry-run
action=install
mode_seen=false
action_seen=false
for argument in "$@"; do
  case "$argument" in
    --dry-run|--execute)
      [[ "$mode_seen" == false ]] || { echo "Mode may be specified only once" >&2; exit 2; }
      mode=$argument; mode_seen=true ;;
    install|uninstall)
      [[ "$action_seen" == false ]] || { echo "Action may be specified only once" >&2; exit 2; }
      action=$argument; action_seen=true ;;
    *) echo "Usage: $0 [--dry-run|--execute] [install|uninstall]" >&2; exit 2 ;;
  esac
done

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
infra_dir=$(cd -- "$script_dir/.." && pwd)
state=/var/lib/deniz-cloud/posix-host-boundary
manifest=$state/installed.sha256
units=(
  deniz-cloud-storage.target
  deniz-cloud-storage-namespace.service
  deniz-cloud-storage-firewall.service
  deniz-cloud-storage-smb.service
  deniz-cloud-storage-api-broker.service
  deniz-cloud-storage-watchdog.service
)

destinations=(
  /usr/local/lib/deniz-cloud/posix-storage-host.sh
  /etc/samba/deniz-cloud-storage.conf
)
sources=(
  "$script_dir/posix-storage-host.sh"
  "$infra_dir/samba/posix-storage-smb.conf"
)
for unit in "${units[@]}"; do
  sources+=("$infra_dir/systemd/$unit")
  destinations+=("/etc/systemd/system/$unit")
done

if [[ "$mode" == --dry-run ]]; then
  jq -n --arg mode "$mode" --arg action "$action" --argjson files "$(printf '%s\n' "${destinations[@]}" | jq -R . | jq -s .)" '{mode:$mode,action:$action,writes:false,files:$files,activatesServices:false,preservesNamespaceData:true,preservesSecrets:true}'
  exit 0
fi
(( EUID == 0 )) || { echo "Execute mode requires root" >&2; exit 1; }

install_boundary() {
  [[ ! -e "$manifest" && ! -L "$manifest" ]] || { echo "Boundary is already installed; uninstall the exact manifest first" >&2; return 1; }
  local index destination source
  for index in "${!sources[@]}"; do
    source=${sources[$index]}; destination=${destinations[$index]}
    [[ -f "$source" && ! -L "$source" ]] || { echo "Unsafe source: $source" >&2; return 1; }
    if [[ -e "$destination" || -L "$destination" ]]; then
      [[ -f "$destination" && ! -L "$destination" && "$(sha256sum "$destination" | awk '{print $1}')" == "$(sha256sum "$source" | awk '{print $1}')" ]] || { echo "Refusing to overwrite: $destination" >&2; return 1; }
    fi
  done
  install -d -m 0755 /usr/local/lib/deniz-cloud /etc/samba /etc/systemd/system
  install -d -m 0755 -o root -g root /srv/deniz-cloud/storage /srv/deniz-cloud/internal /srv/deniz-cloud/api-storage
  install -d -m 0755 -o root -g root /srv/deniz-cloud/internal/.capacity
  install -d -m 0700 /etc/deniz-cloud "$state"
  for index in "${!sources[@]}"; do
    destination=${destinations[$index]}
    if [[ "$destination" == *.sh ]]; then install -m 0755 "${sources[$index]}" "$destination"; else install -m 0644 "${sources[$index]}" "$destination"; fi
  done
  : > "$manifest"
  for destination in "${destinations[@]}"; do sha256sum "$destination" >> "$manifest"; done
  chmod 0600 "$manifest"
  [[ -e /etc/deniz-cloud/posix-storage.env || -L /etc/deniz-cloud/posix-storage.env ]] || install -m 0600 "$infra_dir/posix-storage/posix-storage.env.example" /etc/deniz-cloud/posix-storage.env.example
  [[ -e /etc/deniz-cloud/posix-api-broker.credentials || -L /etc/deniz-cloud/posix-api-broker.credentials ]] || install -m 0600 "$infra_dir/posix-storage/api-broker.credentials.example" /etc/deniz-cloud/posix-api-broker.credentials.example
  systemctl daemon-reload
  jq -n '{installed:true,activated:false,next:"configure, validate, then explicitly enable/start deniz-cloud-storage.target"}'
}

uninstall_boundary() {
  [[ -f "$manifest" && ! -L "$manifest" ]] || { echo "Exact install manifest is missing" >&2; return 1; }
  (cd / && sha256sum -c "$manifest") || { echo "Installed files changed; refusing partial uninstall" >&2; return 1; }
  systemctl disable --now deniz-cloud-storage.target || true
  systemctl stop deniz-cloud-storage-watchdog.service deniz-cloud-storage-api-broker.service deniz-cloud-storage-smb.service deniz-cloud-storage-namespace.service || true
  /usr/local/lib/deniz-cloud/posix-storage-host.sh --execute firewall-stop
  local destination
  for destination in "${destinations[@]}"; do rm -f -- "$destination"; done
  rm -f -- "$manifest"
  rmdir /srv/deniz-cloud/internal/.capacity /srv/deniz-cloud/api-storage /srv/deniz-cloud/storage /srv/deniz-cloud/internal /srv/deniz-cloud 2>/dev/null || true
  rmdir "$state" 2>/dev/null || true
  systemctl daemon-reload
  jq -n '{uninstalled:true,namespaceDataDeleted:false,secretsDeleted:false,operatorConfigDeleted:false}'
}

case "$action" in install) install_boundary ;; uninstall) uninstall_boundary ;; esac
