#!/usr/bin/env bash

# Reconcile an enabled source-host boundary after releases or interrupted
# service restarts. A deliberate watchdog fail-close must never be undone.
set -Eeuo pipefail
target=deniz-cloud-storage.target
watchdog=deniz-cloud-storage-watchdog.service
[[ "$(systemctl show "$target" -p LoadState --value)" == loaded ]] || exit 0
systemctl is-enabled --quiet "$target" || exit 0
lease="$(dig +short TXT _active-site-pi.denizlg24.com | tr -d '\"')"
expected="$(awk -F= '$1=="DR_ACTIVE_SITE_VALUE" {sub(/^[^=]*=/, ""); print; exit}' /etc/deniz-dr/pi.env)"
[[ "$expected" == home || "$expected" == dr ]] || { echo 'Configured storage role is invalid; refusing reconciliation.' >&2; exit 1; }
[[ "$lease" == "$expected" ]] || { echo 'Storage lease does not match the configured role; refusing reconciliation.' >&2; exit 1; }
if [[ "$(systemctl show "$watchdog" -p ExecMainStatus --value)" == 20 ]]; then
  echo 'Storage watchdog deliberately failed closed; explicit storage recovery is required.' >&2
  exit 1
fi
systemctl start "$target"
systemctl is-active --quiet "$target"
for service in namespace metadata firewall smb api-broker watchdog; do
  systemctl is-active --quiet "deniz-cloud-storage-${service}.service" || {
    echo "Storage boundary component is not active: $service" >&2
    exit 1
  }
done
