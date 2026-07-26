# Tailscale remote access

The tailnet is the primary way in. Setup is done; this records the shape and the
recovery paths.

## Current state

- Pi is `pi-cloud` at `100.89.155.9`, advertising `192.168.1.0/24` as a subnet
  router, with Tailscale SSH enabled.
- **Key expiry is disabled on the Pi.** An expired node key while abroad is a
  lockout. Verify it stays off after any re-auth.
- Reach it with `tailscale ssh denizlg24@pi-cloud` — no password.
- The Pi's tailnet address is also how the API container reaches host services
  (see the terminal notes in `../README.md`); `host.docker.internal` resolves to
  the docker0 gateway, which is unroutable from the compose network.
- Tailnet ACLs grant only the operator identity access to the Pi and the LAN
  route, with `action: "check"` on SSH so the operator reauthenticates
  periodically without the Pi's node key expiring.

## Break-glass

Three independent paths — keep them that way:

1. **WAN SSH** — router forwards TCP 22, UFW rate-limits it. Tailscale SSH does
   not touch `sshd_config` or `authorized_keys`, so key auth still works.
2. **Cloudflare Tunnel** — an independent application path and health signal.
   Not a shell unless a Cloudflare Access SSH route is configured.
3. **Physical / LAN access.**

If Tailscale is down but WAN SSH works:

```sh
sudo systemctl status tailscaled --no-pager
sudo systemctl restart tailscaled
sudo tailscale status
```

Only re-authenticate from a WAN, LAN or physical session — never from the sole
Tailscale session, which the command drops:

```sh
sudo tailscale up --hostname=pi-cloud --ssh \
  --advertise-routes=192.168.1.0/24 --force-reauth
```

If the node key has already expired, extend or disable expiry from the Machines
page first; otherwise re-auth is the only route back in.

## Rebuilding from scratch

If the Pi is reimaged: install Tailscale, enable IPv4/IPv6 forwarding,
`tailscale up` with the flags above, then approve the subnet route and disable
key expiry in the admin console. Confirm off-LAN access from a phone hotspot
before relying on it.

- [Install](https://tailscale.com/docs/install/linux)
- [Subnet routers and the key-expiry caveat](https://tailscale.com/docs/features/subnet-routers)
- [Tailscale SSH](https://tailscale.com/docs/features/tailscale-ssh)
