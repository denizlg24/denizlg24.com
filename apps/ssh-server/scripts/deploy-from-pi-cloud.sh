#!/usr/bin/env bash
# Runs on pi-cloud, not on the CI runner. pi-two is LAN-only and not on the
# tailnet, so the tailnet-connected Pi is the only host that can reach it.
# Authentication for this hop is pi-cloud's own key; no private key is ever
# handed to GitHub Actions.
set -euo pipefail
trap 'echo "deploy-from-pi-cloud.sh failed at line ${LINENO}" >&2' ERR

: "${PI_TWO_HOST:?PI_TWO_HOST is required}"
PI_TWO_PORT="${PI_TWO_PORT:-2222}"
PI_TWO_USER="${PI_TWO_USER:-denizlg24}"
APP_DIR="${APP_DIR:-/home/denizlg24/ssh-website}"
STAGE_DIR="${STAGE_DIR:-/tmp/ssh-server-deploy}"

target="${PI_TWO_USER}@${PI_TWO_HOST}"
common_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

# Mode is deliberately not checked: scp's SFTP backend does not carry the
# source mode across, and the binary never runs here anyway — the installer on
# pi-two sets the real mode with `install -m 755`.
for f in ssh-server ssh-server.service; do
  if [ ! -f "${STAGE_DIR}/${f}" ]; then
    echo "staged payload is missing ${f}; ${STAGE_DIR} holds:" >&2
    ls -la "${STAGE_DIR}" >&2 || true
    exit 1
  fi
done

echo "copying $(du -h "${STAGE_DIR}/ssh-server" | cut -f1) to ${target}"
scp "${common_opts[@]}" -P "${PI_TWO_PORT}" \
  "${STAGE_DIR}/ssh-server" \
  "${STAGE_DIR}/ssh-server.service" \
  "${target}:/tmp/"

ssh "${common_opts[@]}" -p "${PI_TWO_PORT}" "${target}" \
  "APP_DIR='${APP_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
app_dir="${APP_DIR:?}"

mkdir -p "$app_dir"
install -m 755 /tmp/ssh-server "$app_dir/ssh-server.new"

# Keep the outgoing binary so a failed restart can be rolled back. Renaming
# over a running executable is fine on Linux; writing into it is not.
[ -f "$app_dir/ssh-server" ] && cp -a "$app_dir/ssh-server" "$app_dir/ssh-server.prev"
mv -f "$app_dir/ssh-server.new" "$app_dir/ssh-server"

unit=/etc/systemd/system/ssh-server.service
if ! cmp -s /tmp/ssh-server.service "$unit"; then
  sudo -n install -m 644 /tmp/ssh-server.service "$unit"
  sudo -n systemctl daemon-reload
fi

sudo -n systemctl restart ssh-server

# The unit owns the listen port, so read it back rather than assuming 22.
port="$(sed -n 's/^Environment=PORT=//p' "$unit" | tail -n1)"
port="${port:-22}"

for _ in $(seq 1 15); do
  if systemctl is-active --quiet ssh-server &&
    (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    rm -f /tmp/ssh-server /tmp/ssh-server.service "$app_dir/ssh-server.prev"
    echo "ssh-server is live on port ${port}"
    exit 0
  fi
  sleep 2
done

echo "ssh-server did not come up on port ${port}; rolling back" >&2
sudo -n journalctl -u ssh-server -n 40 --no-pager >&2 || true
if [ -f "$app_dir/ssh-server.prev" ]; then
  mv -f "$app_dir/ssh-server.prev" "$app_dir/ssh-server"
  sudo -n systemctl restart ssh-server
fi
exit 1
REMOTE
