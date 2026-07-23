# Tailscale remote-access setup

This is the remote-access lifeline for the Raspberry Pi and the home LAN.
Complete it while physically on the home network and keep the existing WAN SSH
port-forward and Cloudflare Tunnel running. Nothing here stops or replaces the
old deniz-cloud stack.

The commands assume Ubuntu Server on the Pi, the Pi login user is `pi`, the
Pi's Tailscale machine name is `deniz-cloud-pi`, and the approved home LAN route
is `192.168.1.0/24`.

## 1. Record the current recovery paths

Before changing networking, open two local SSH sessions to the Pi. Keep one
untouched as a recovery shell.

On the Pi, record the addresses and confirm the existing services:

```sh
hostname
ip -4 address show
ip -4 route show
sudo ufw status verbose
sudo systemctl is-active ssh
sudo systemctl is-active cloudflared
```

Record these values somewhere available away from home:

- Pi LAN address, for example `192.168.1.20`
- Home LAN CIDR, for example `192.168.1.0/24`
- Public SSH hostname or IP
- Router administration recovery procedure

The LAN CIDR is the non-Docker, non-loopback network containing the Pi's LAN
address. Do not advertise a Docker network, `0.0.0.0/0`, or the Tailscale
`100.64.0.0/10` range.

## 2. Install Tailscale and enable forwarding

Install the official stable Tailscale package:

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
tailscale version
```

Enable persistent IPv4 and IPv6 forwarding, as required for a Linux subnet
router:

```sh
sudo tee /etc/sysctl.d/99-tailscale.conf >/dev/null <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

Both values printed by the last command must be `1`.

## 3. Join the tailnet and advertise the LAN

Run the following command with the home LAN CIDR found in step 1:

```sh
sudo tailscale up \
  --hostname=deniz-cloud-pi \
  --ssh \
  --advertise-routes=192.168.1.0/24
```

Open the authentication URL printed by the command and sign in with the
operator's Tailscale account. Do not use a reusable auth key for this permanent
host.

Confirm the Pi is connected:

```sh
sudo tailscale status
sudo tailscale ip -4
sudo tailscale set --ssh
```

`tailscale status` must list `deniz-cloud-pi` without an expired, stopped, or
offline state.

## 4. Approve and protect the Pi in the admin console

1. Open the [Machines page](https://login.tailscale.com/admin/machines).
2. Find `deniz-cloud-pi` and approve the device if device approval is enabled.
3. Open the machine's route settings and approve `192.168.1.0/24`.
4. Open the machine's ellipsis menu and select **Disable key expiry**. Reopen
   the menu and confirm it now offers **Enable key expiry**; that inverse action
   confirms expiry is disabled.
5. Open the [DNS page](https://login.tailscale.com/admin/dns) and enable
   **MagicDNS** if it is not already enabled.

An expired subnet-router key leaves the route configured but unreachable, so
disabling expiry on this permanent remote node is mandatory.

## 5. Restrict tailnet access

Open the [Access controls
page](https://login.tailscale.com/admin/acls/file). Preserve the existing policy
and ensure it grants only the operator identity network access to the Pi and
home LAN, plus Tailscale SSH access as the non-root `pi` user. Replace
`<OPERATOR_EMAIL>` with the operator's Tailscale login before merging these
entries into the existing `grants` and `ssh` arrays:

```json
{
  "grants": [
    {
      "src": ["<OPERATOR_EMAIL>"],
      "dst": ["autogroup:self"],
      "ip": ["tcp:22"]
    },
    {
      "src": ["<OPERATOR_EMAIL>"],
      "dst": ["192.168.1.0/24"],
      "ip": ["*"]
    }
  ],
  "ssh": [
    {
      "action": "check",
      "checkPeriod": "12h",
      "src": ["<OPERATOR_EMAIL>"],
      "dst": ["autogroup:self"],
      "users": ["pi"]
    }
  ]
}
```

The policy editor validates the complete policy before saving. Do not replace
unrelated existing rules with the fragment above. `action: "check"` requires
the operator to reauthenticate periodically for SSH without expiring the Pi's
node key.

## 6. Enroll the operator devices

Install Tailscale on the operator's laptop and phone from the official
[download page](https://tailscale.com/download), sign in to the same tailnet,
and approve both devices if device approval is enabled.

The operator laptop runs macOS, which accepts approved subnet routes by
default. Linux clients do not; on a Linux client, run:

```sh
sudo tailscale set --accept-routes
```

macOS, Windows, iOS, and Android clients accept subnet routes by default.

From the laptop while still on the home network:

```sh
tailscale ping deniz-cloud-pi
tailscale ssh pi@deniz-cloud-pi
```

Inside the Tailscale SSH session, verify the expected account and sudo access:

```sh
whoami
sudo -n true
```

`whoami` must print `pi`. If `sudo -n true` fails because the account requires a
password, verify interactive `sudo true` instead; do not weaken the sudo policy.

## 7. Required off-LAN verification

Disconnect the laptop from home Wi-Fi and connect it through a phone hotspot.
Confirm that the laptop is not using the home public Wi-Fi before testing.

```sh
tailscale status
tailscale ping deniz-cloud-pi
tailscale ssh pi@deniz-cloud-pi
```

Then verify subnet routing against one known, powered-on LAN device:

```sh
ping <LAN_DEVICE_IP>
```

The acceptance gate is:

- `tailscale ping` reaches `deniz-cloud-pi` from the hotspot.
- `tailscale ssh pi@deniz-cloud-pi` opens a shell from the hotspot.
- A known LAN address responds through the approved subnet route.
- The phone shows connected in the Tailscale app on cellular data.

### Gate record

Passed on 2026-07-23:

- Laptop: macOS, tested off-LAN.
- Pi tailnet address: `100.89.155.9`.
- Approved subnet route: `192.168.1.0/24`.
- `tailscale ping deniz-cloud-pi`: passed.
- `tailscale ssh pi@deniz-cloud-pi`: passed.
- Known LAN devices through the subnet route: reachable.

The operator also confirmed the subnet route is approved in the Tailscale admin
console.

## 8. Break-glass access

Keep these paths independent:

1. **WAN SSH**: retain router TCP port-forward `22` to the Pi through cutover.
   Plan 011's host-hardening step rate-limits port 22 in UFW. SSH keys remain
   configured because Tailscale SSH does not modify `sshd_config` or
   `authorized_keys`.
2. **Cloudflare Tunnel**: keep the host `cloudflared` service and current
   ingress rules running until plan 012 changes them. This is an independent
   application path and health signal; it is not a shell unless a separate
   Cloudflare Access SSH route has been configured and tested.
3. **Physical/LAN access**: retain the Pi's LAN address and router access
   details for someone physically at home.

If Tailscale fails but WAN SSH works:

```sh
sudo systemctl status tailscaled --no-pager
sudo systemctl restart tailscaled
sudo tailscale status
```

If the Pi's node key expires, disable key expiry or extend the key from the
Machines page first. Only use the following reauthentication command from a
WAN, LAN, or physical recovery session, never from the sole Tailscale session:

```sh
sudo tailscale up --force-reauth
```

Reapply the hostname, SSH, and advertised route after recovery if the command
reports that non-default settings must be restated:

```sh
sudo tailscale up \
  --hostname=deniz-cloud-pi \
  --ssh \
  --advertise-routes=192.168.1.0/24 \
  --force-reauth
```

## References

- [Install Tailscale on Linux](https://tailscale.com/docs/install/linux)
- [Subnet-router setup and key-expiry caveat](https://tailscale.com/docs/features/subnet-routers)
- [Tailscale SSH configuration](https://tailscale.com/docs/features/tailscale-ssh)
- [MagicDNS](https://tailscale.com/docs/features/magicdns)
- [Disable key expiry](https://tailscale.com/docs/features/access-control/key-expiry)
