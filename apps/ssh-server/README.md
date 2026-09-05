# ssh-server

`ssh me.denizlg24.com` renders a terminal portrait and info card instead of
opening a shell. It is a Go SSH server built with
[charmbracelet/wish](https://github.com/charmbracelet/wish) and lipgloss.

The card's age is computed from a birthdate at render time, so it never goes
stale, and the ASCII portrait is drawn with a vertical forest-green to brown
gradient.

## Running it locally

```sh
PREVIEW=1 go run .   # print the card to the current terminal and exit
make run             # serve on port 2222, then: ssh -p 2222 localhost
```

`make build` produces a native binary; `make build-pi` cross-compiles for the
ARMv6 Raspberry Pi Zero W that hosts it, which is too slow to build Go
comfortably itself.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `22` | Listen port |
| `HOST_KEY_PATH` | `.ssh/host_key` | SSH host key location |
| `PREVIEW` | unset | Set to `1` to print the card and exit |

An ed25519 host key is generated on first run if none exists at
`HOST_KEY_PATH`. Pinning one in advance keeps the fingerprint stable across
rebuilds of the host.

## How it is deployed

The service answers on port 22, so the device's own SSH daemon moves to a
different port and administrative access uses that instead. Binding a
privileged port means the unit runs as root, or with the capability to bind low
ports.

Deployment is automated: a push to the default branch that touches this
application cross-compiles for ARMv6, ships the binary, restarts the unit,
health-gates the result, and rolls back on failure.

The interesting part is the path it takes. The device is not on the tailnet,
but the cloud Pi is and shares its LAN, so the cloud Pi acts as a relay:

```text
runner --tailscale--> pi-cloud --LAN ssh--> pi-two
```

The runner joins the tailnet, stages the binary on the relay, and runs the
deploy script there. That script owns the LAN hop using the relay's own key,
which is what keeps any credential for the target device out of continuous
integration entirely.

Two design details on the target are deliberate. The relay's SSH client
configuration pins a single identity for that host, because otherwise the
client walks its default keys first and can exhaust the server's authentication
attempt limit before reaching the right one. And the passwordless privilege
rules on the target are exact argument matches rather than wildcards: a
wildcard on the log-reading command, for example, would let that account read
any unit's logs as root.
