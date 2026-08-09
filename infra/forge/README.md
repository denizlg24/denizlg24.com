# Forge host

The public boundary is Cloudflare Tunnel. Do not expose Caddy, the deploy
agent, or the resource agent directly on the server's public interface.

## Traffic shape

```text
forge-server.denizlg24.com -> cloudflared -> 127.0.0.1:<resource-agent-port>
*.denizlg24.com            -> cloudflared -> 127.0.0.1:8080 (Caddy)
Cloud API (DEPLOY_AGENT_URL) -> Tailscale -> 100.114.10.73:4010 (deploy-agent)
deploy-agent (CONTROL_PLANE_URL) -> https://api.denizlg24.com
```

The resource-agent route is public but HMAC-authenticated. The deploy agent is
Bearer-authenticated and tailnet-only. Caddy's admin API stays on
`127.0.0.1:2019`.

## Firewall

Resolve the SSH rule before enabling UFW so the current session cannot be
locked out. On this host, Tailscale is the management path:

```sh
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH via Tailscale'
sudo ufw allow in on tailscale0 to any port 4010 proto tcp comment 'Forge deploy agent'
sudo ufw allow 41641/udp comment 'Tailscale direct connections'
sudo ufw enable
sudo ufw status verbose
```

Do not add inbound rules for `80`, `443`, `8080`, `2019`, or the resource-agent
port. `cloudflared` initiates outbound connections; the default outgoing policy
already permits its HTTPS/QUIC traffic. If outbound traffic is ever restricted,
allow DNS and Cloudflare Tunnel traffic on TCP/UDP `7844` plus HTTPS on TCP
`443` before tightening it.

Verify listeners after any service change:

```sh
sudo ss -lntup
curl -fsS http://127.0.0.1:2019/config/ >/dev/null
curl -fsS http://100.114.10.73:4010/healthz
```

The final check should be run from a tailnet peer when UFW is active. An
unsigned request to `https://forge-server.denizlg24.com/resource/health` should
return `401`; that confirms the tunnel is reachable without bypassing HMAC.

## Cloud API configuration

Set all three together on the self-hosted API:

```text
FORGE_RESOURCE_AGENT_URL=https://forge-server.denizlg24.com
FORGE_RESOURCE_AGENT_NODE_ID=<resource-agent node id>
FORGE_RESOURCE_AGENT_SECRET=<same secret as resource-agent>
```

`DEPLOY_AGENT_URL` remains the Tailscale URL, for example
`http://100.114.10.73:4010`; it must never point at a public hostname.
