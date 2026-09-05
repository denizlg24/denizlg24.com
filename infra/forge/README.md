# Forge host

The host that builds and runs the application deployments. Its public boundary
is a Cloudflare Tunnel; neither the reverse proxy nor the deploy agent is
exposed on the server's public interface.

## Traffic shape

```text
*.denizlg24.com               -> cloudflared -> loopback -> Caddy
Cloud API (DEPLOY_AGENT_URL)  -> Tailscale  -> deploy-agent
deploy-agent (CONTROL_PLANE_URL) -> https://api.denizlg24.com
```

The deploy agent is bearer-authenticated and reachable only over the tailnet;
its configured URL is a tailnet address and must never be a public hostname. It
collects the host and Forge-scoped container telemetry the dashboard renders.
Caddy's admin API stays on loopback.

## Firewall

The host runs default-deny inbound. The only inbound rules are SSH and the
deploy agent, both restricted to the tailnet interface, plus the UDP port
Tailscale uses to establish direct connections. Nothing inbound is opened for
HTTP, HTTPS, the proxy's own port or the proxy admin API: `cloudflared`
initiates outbound connections, so the tunnel needs no inbound rule at all.

Because the tailnet is the management path, the SSH rule has to exist before
default-deny is enabled, or the session enabling it locks itself out. If
outbound traffic is ever restricted too, the tunnel needs DNS plus its own
transport port and HTTPS allowed before tightening.

## Cloudflare Tunnel naming

A tunnel's display name and the public hostnames it serves are separate
Cloudflare objects. The tunnel can keep any display name while serving
`forge.denizlg24.com`, because the DNS record points at the tunnel's UUID under
`cfargotunnel.com` rather than at its name.

## Upgrade ordering

The deploy agent and the cloud API are versioned independently, and the newer
agent response is backwards-compatible with the older API while the newer API
expects a host snapshot only the newer agent sends. The agent therefore goes
out first, then the API and the dashboard.
