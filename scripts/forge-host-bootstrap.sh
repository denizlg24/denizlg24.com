#!/usr/bin/env bash
# Prepares a Debian/Ubuntu deploy host for the Forge agent.
#
# Idempotent: safe to re-run after a partial failure or a package upgrade.
# Installs nothing that the agent does not shell out to, and creates one
# unprivileged service account rather than running anything as root.
#
#   sudo ./forge-host-bootstrap.sh
#
# Afterwards, from the laptop:
#   bun scripts/forge-agent-env.mjs --bind=<this host's tailscale ip>
#   scp infra/systemd/forge-agent.env      <host>:/tmp/agent.env
#   scp infra/systemd/forge-agent.service  <host>:/tmp/
#   scp infra/systemd/forge-caddy.service  <host>:/tmp/
#   scp apps/deploy-agent/dist/forge-agent <host>:/tmp/
# then run the "install" section printed at the end.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo" >&2
  exit 1
fi

echo "==> packages"
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git debian-keyring debian-archive-keyring \
  apt-transport-https

# --- docker -----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "==> docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

# --- caddy ------------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> caddy"
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy
fi
# The packaged unit ships a Caddyfile this host must not use: the agent owns
# the config and does a full POST /load. Ours replaces it entirely.
systemctl disable --now caddy 2>/dev/null || true

# --- nixpacks ---------------------------------------------------------------
if ! command -v nixpacks >/dev/null 2>&1; then
  echo "==> nixpacks"
  curl -fsSL https://nixpacks.com/install.sh | bash
fi

# --- cloudflared ------------------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "==> cloudflared"
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    > /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
https://pkg.cloudflare.com/cloudflared $(. /etc/os-release && echo "$VERSION_CODENAME") main" \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
  apt-get install -y cloudflared
fi

# --- tailscale --------------------------------------------------------------
if ! command -v tailscale >/dev/null 2>&1; then
  echo "==> tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# --- service account --------------------------------------------------------
# No shell, no home, no sudo. Its only privilege is the docker group, which is
# root-equivalent in practice — which is exactly why it is not a human login.
echo "==> forge user"
if ! id -u forge >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /srv/forge \
    --shell /usr/sbin/nologin forge
fi
usermod -aG docker forge

echo "==> directories"
mkdir -p /srv/forge/{builds,logs,cache,caddy} /etc/forge
chown -R forge:forge /srv/forge
chmod 0750 /srv/forge
# /run is already a tmpfs; systemd's RuntimeDirectory=forge creates and wipes
# /run/forge on each start, which is what keeps a resolved env set off disk.

echo "==> docker network"
docker network inspect forge-apps >/dev/null 2>&1 \
  || docker network create forge-apps

echo "==> caddy bootstrap config"
cat > /etc/forge/caddy-bootstrap.json <<'JSON'
{
  "admin": { "listen": "127.0.0.1:2019" },
  "apps": { "http": { "servers": {} } },
  "logging": { "logs": { "default": { "level": "ERROR" } } }
}
JSON
chown root:forge /etc/forge/caddy-bootstrap.json
chmod 0640 /etc/forge/caddy-bootstrap.json

cat <<'NEXT'

==> host is prepared. Remaining steps, in order:

  1. tailscale up                       # note the 100.x address
  2. cloudflared tunnel login
     cloudflared tunnel create forge    # the UUID is FORGE_TUNNEL_ID
     # /etc/cloudflared/config.yml — catch-all, never per-hostname:
     #   tunnel: <uuid>
     #   credentials-file: /etc/cloudflared/<uuid>.json
     #   ingress:
     #     - service: http://127.0.0.1:8080
     cloudflared service install

  3. install what you scp'd:
     install -o root -g forge -m 0640 /tmp/agent.env /etc/forge/agent.env
     install -o root -g root  -m 0755 /tmp/forge-agent /usr/local/bin/forge-agent
     install -o root -g root  -m 0644 /tmp/forge-agent.service /etc/systemd/system/
     install -o root -g root  -m 0644 /tmp/forge-caddy.service /etc/systemd/system/
     systemctl daemon-reload
     systemctl enable --now forge-caddy forge-agent

  4. verify:
     curl -s localhost:2019/config/ | head -c 80        # caddy admin
     curl -s localhost:4010/healthz                     # agent
     journalctl -u forge-agent -f                       # claims should stop erroring

  5. on the Pi, so the agent can reach the control plane:
     # infra/compose/.env.pi
     API_BIND_ADDRESS=100.89.155.9
     # then recreate: docker compose ... up -d api

NEXT
