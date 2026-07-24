#!/bin/bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "${script_dir}/.." && pwd)"
systemd_dir="${infra_dir}/systemd"

install -d -m 755 /usr/local/lib/deniz-cloud
install -d -m 700 /etc/deniz-cloud /var/lib/deniz-cloud
install -m 755 "${script_dir}/ddns-update.sh" \
  /usr/local/lib/deniz-cloud/ddns-update.sh
install -m 755 "${script_dir}/deploy-db-certs.sh" \
  /usr/local/lib/deniz-cloud/deploy-db-certs.sh
install -m 755 "${script_dir}/provision-db-certs.sh" \
  /usr/local/lib/deniz-cloud/provision-db-certs.sh
install -m 600 "${systemd_dir}/terminal.env.example" \
  /etc/deniz-cloud/terminal.env.example

if ! id pi-terminal >/dev/null 2>&1; then
  useradd \
    --system \
    --user-group \
    --home-dir /var/lib/cloud-terminal \
    --shell /bin/bash \
    pi-terminal
fi
install -d -m 700 -o pi-terminal -g pi-terminal /var/lib/cloud-terminal

for unit in \
  cloud-terminal.service \
  cloud-reboot.path \
  cloud-reboot.service \
  cloud-ddns.service \
  cloud-ddns.timer \
  cloud-db-cert-renew.service \
  cloud-db-cert-renew.timer; do
  install -m 644 "${systemd_dir}/${unit}" "/etc/systemd/system/${unit}"
done

systemctl daemon-reload
systemctl enable cloud-reboot.path cloud-ddns.timer cloud-db-cert-renew.timer

echo "Installed host units."
echo "Before starting them:"
echo "  1. Create /etc/deniz-cloud/ddns.env (mode 600)."
echo "  2. Copy and edit /etc/deniz-cloud/terminal.env.example as terminal.env."
echo "  3. Install tmux and /usr/local/bin/cloud-terminal."
echo "  4. Run: systemctl enable --now cloud-terminal.service"
