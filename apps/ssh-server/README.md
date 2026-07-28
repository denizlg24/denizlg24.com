# ssh-server

When someone runs `ssh me.denizlg24.com`,
they get a rendered terminal portrait + info card (built with
[charmbracelet/wish](https://github.com/charmbracelet/wish) + lipgloss).

The card's age is computed live from the birthdate, so it never goes stale, and the
ASCII portrait is rendered with a vertical forest-green→brown gradient.

## Local preview

See exactly what visitors get, straight to your own terminal — no SSH needed:

```sh
PREVIEW=1 go run .
```

Or via the Makefile (runs a real server on port 2222, then `ssh -p 2222 localhost`):

```sh
make run
```

## Build

```sh
make build       # native binary for the current machine
make build-pi    # cross-compiled for Raspberry Pi Zero W (linux/arm/ARMv6)
```

## Deploy to a Raspberry Pi Zero W

The goal: this app answers normal SSH (`ssh denizlg24.com`, port **22**), so the
Pi's own SSH daemon must move out of the way to port **2222**.

### 1. Move the system SSH daemon to port 2222

On the Pi, edit `/etc/ssh/sshd_config`:

```sh
sudo sed -i 's/^#\?Port .*/Port 2222/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

> ⚠️ Keep your current SSH session open until you've confirmed the new port works.
> From your laptop, test in a second terminal: `ssh -p 2222 denizlg24@<pi-ip>`.
> Only close the old session once 2222 logs you in.

If you use UFW or another firewall, open the new admin port:

```sh
sudo ufw allow 2222/tcp
sudo ufw allow 22/tcp
```

### 2. Cross-compile and copy the app to the Pi

From your dev machine (the Pi Zero W is too slow to build Go comfortably):

```sh
make build-pi
scp -P 2222 ssh-server ssh-server.service denizlg24@<pi-ip>:~/ssh-website/
```

(The repo expects the app to live at `/home/denizlg24/ssh-website/` — see the service file.)

### 3. Host key

`wish` auto-generates an ed25519 host key at `HOST_KEY_PATH` on first run if it
doesn't exist. To pin one yourself instead:

```sh
mkdir -p ~/ssh-website/.ssh
ssh-keygen -t ed25519 -f ~/ssh-website/.ssh/host_key -N ""
```

### 4. Install and run the systemd service

The service binds port **22**, which requires root (or `CAP_NET_BIND_SERVICE`).
It runs as root by default since no `User=` is set.

```sh
sudo cp ~/ssh-website/ssh-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ssh-server
```

Check it:

```sh
systemctl status ssh-server
journalctl -u ssh-server -f      # live logs
```

### 5. Test it

From anywhere:

```sh
ssh me.denizlg24.com          # or ssh <pi-ip>
```

You should see the card. Admin access is now `ssh -p 2222 denizlg24@<pi-ip>`.

## Updating after a code change

CI does this. Any push to `main` touching `apps/ssh-server/**` (except this
README) runs `.github/workflows/deploy-ssh-server.yml`: cross-compile for ARMv6,
ship to pi-two, restart, health-gate, roll back on failure.

Manual fallback:

```sh
make build-pi
scp -P 2222 ssh-server denizlg24@<pi-ip>:~/ssh-website/
ssh -p 2222 denizlg24@<pi-ip> 'sudo systemctl restart ssh-server'
```

### How the deploy reaches pi-two

pi-two is not on the tailnet. pi-cloud is, and shares its LAN, so pi-cloud
relays: the runner joins the tailnet, stages the binary on pi-cloud, and runs
`scripts/deploy-from-pi-cloud.sh` there. That script owns the LAN hop using
pi-cloud's own key, so no pi-two credential is ever stored in GitHub.

```text
runner --tailscale--> pi-cloud --LAN, ssh -p 2222--> pi-two
```

Repository variables: `PI_TAILNET_HOST` = `pi-cloud`, `PI_TWO_LAN_HOST` =
`pi-two`. `PI_TWO_LAN_HOST` must match the `Host` pattern in pi-cloud's
`~/.ssh/config` below, or ssh never offers the deploy key.

### Bootstrap (done — recorded for a rebuild)

**Key auth from pi-cloud to pi-two.** The relay is non-interactive, so the
password prompt has to go away. From pi-cloud, typing the password once:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/pi-two-deploy -N "" -C 'ci-deploy@pi-cloud'
ssh-copy-id -i ~/.ssh/pi-two-deploy.pub -p 2222 denizlg24@192.168.1.239
cat >> ~/.ssh/config <<'EOF'

Host pi-two pi-two.lan 192.168.1.239
  HostName 192.168.1.239
  Port 2222
  User denizlg24
  IdentityFile ~/.ssh/pi-two-deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

`IdentitiesOnly yes` matters: without it ssh walks its default keys first and
can exhaust `MaxAuthTries` before reaching this one.

**Passwordless sudo on pi-two.** The unit binds port 22 and runs as root, so
restarting it needs sudo, and the deploy calls `sudo -n` (never prompts). Every
rule is an exact argv match — no wildcards, since `journalctl *` would let this
account read any unit's logs as root. On pi-two:

```sh
sudo tee /etc/sudoers.d/ssh-server-deploy >/dev/null <<'EOF'
denizlg24 ALL=(root) NOPASSWD: /usr/bin/systemctl restart ssh-server, \
  /usr/bin/systemctl daemon-reload, \
  /usr/bin/journalctl -u ssh-server -n 40 --no-pager, \
  /usr/bin/install -m 644 /tmp/ssh-server.service /etc/systemd/system/ssh-server.service
EOF
sudo chmod 440 /etc/sudoers.d/ssh-server-deploy
sudo visudo -c
```

The `install` rule is the one with teeth: anyone who can write
`/tmp/ssh-server.service` on pi-two can put arbitrary unit content in front of
root. That is the same account the deploy already runs as, so it grants nothing
new, but it is the line to revisit if pi-two ever gains a second user.

Verify from pi-cloud before the first deploy — note `is-active` needs no sudo,
so testing it with `sudo -n` fails misleadingly:

```sh
ssh -o BatchMode=yes pi-two 'systemctl is-active ssh-server'
ssh -o BatchMode=yes pi-two 'sudo -n systemctl daemon-reload && echo sudo ok'
```

## Environment variables

| Var             | Default          | Purpose                          |
|-----------------|------------------|----------------------------------|
| `HOST`          | `0.0.0.0`        | Bind address                     |
| `PORT`          | `22`             | Listen port                      |
| `HOST_KEY_PATH` | `.ssh/host_key`  | SSH host key location            |
| `PREVIEW`       | (unset)          | Set to `1` to print card & exit  |
