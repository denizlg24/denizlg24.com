# Pi network and database hardening

Current state and the rules that matter. Apply changes from a Tailscale session
with a second session open.

## Cloudflare Tunnel

Token-based (`cloudflared tunnel run --token …`), so **ingress lives in the
Cloudflare Zero Trust dashboard, not on the Pi** — there is no local
`config.yml`. Current routing:

| Hostname | Origin |
|---|---|
| `api.denizlg24.com` | `http://localhost:3001` |
| `search.denizlg24.com` | `http://localhost:7700` (Meilisearch, legacy consumers) |

`cloud.` and `storage.` are Vercel and do not pass through the tunnel. The old
`storage.`/`cloud.` origin rules were removed at cutover.

`cloudflared`'s own metrics listener is on `127.0.0.1:20241` — host loopback, so
unreachable from containers. `TUNNEL_HEALTH_URL` therefore points at the public
`https://api.denizlg24.com/healthz`, which also proves the tunnel is serving.

## UFW

```sh
sudo bash infra/network/apply-firewall.sh
sudo ufw status numbered
```

Policy:

- `tailscale0` allowed entirely;
- WAN SSH 22 rate-limited (break-glass);
- public database ports 5433, 27018, 6380 open;
- 3001 and 3003 denied from WAN;
- Redis TLS 6381 only with `ENABLE_REDIS_TLS_PORT=true`.

**`INPUT` policy is `DROP` and the docker bridges are not exempt**, so a
container cannot reach any host service without an explicit rule. This is
required for the API to reach the terminal:

```sh
sudo ufw allow from 172.16.0.0/12 to any port 3003 proto tcp
```

Symptom when missing: `TimeoutError` from the API. `ConnectionRefused` instead
means the rule is fine and the host service is down.

The script does not enable UFW or change the default policy. If enabling it for
the first time, confirm both Tailscale and WAN SSH still work first.

## fail2ban

**Ubuntu 24.04 ships fail2ban 1.0.2, which cannot run on Python 3.12** — it
imports `asynchat`, removed from the stdlib in 3.12, and dies with
`No module named 'asynchat'`. Apt has no newer version. Install the upstream
1.1.0 `_all.deb` (architecture-independent):

```sh
sudo dpkg -i /opt/deniz-cloud/cutover/fail2ban_1.1.0-1.upstream1_all.deb
sudo systemctl enable --now fail2ban
sudo fail2ban-client status
```

**Bans against the database ports must be written to `DOCKER-USER`, not INPUT.**
Traffic to a Docker-published port is DNAT'd in PREROUTING and traverses
FORWARD, so a ban in INPUT — which is where UFW and every stock fail2ban action
write — is recorded and never sees the packets. `action.d/deniz-docker-user.conf`
exists for this; the three database jails set `banaction = deniz-docker-user`
while sshd stays on `ufw`, because SSH is a host service and does reach INPUT.

Verify a ban actually lands in the right chain:

```sh
sudo fail2ban-client set deniz-cloud-redis banip 203.0.113.5
sudo iptables -n -L DOCKER-USER
sudo fail2ban-client set deniz-cloud-redis unbanip 203.0.113.5
```

Database security logs go to journald. Redis does not emit failed AUTH to
stderr, so the unprivileged `redis-acl-audit` sidecar converts Redis `ACL LOG`
entries into journal events without touching the Docker socket. Jails and
filters are in `infra/fail2ban/`; the tailnet range and home LAN are
whitelisted.

## Database TLS (optional, accept-both)

Not currently enabled — all three modes are off. To enable, add
`LETSENCRYPT_EMAIL` to `/etc/deniz-cloud/ddns.env`, then:

```sh
sudo apt install certbot python3-certbot-dns-cloudflare
sudo /usr/local/lib/deniz-cloud/provision-db-certs.sh
sudo systemctl enable --now cloud-db-cert-renew.timer
```

One SAN certificate covers the three public database hostnames, written under
`/etc/deniz-cloud/tls` and renewed twice daily. Then set in `.env.pi`:

```dotenv
POSTGRES_TLS_MODE=on
MONGO_TLS_MODE=allowTLS
REDIS_TLS_MODE=allow
```

Postgres and Mongo negotiate TLS on their existing ports while still accepting
plaintext; Redis keeps 6380 and adds 6381. Client opt-in:

```text
postgresql://USER:PASSWORD@postgres.denizlg24.com:5433/DB?sslmode=verify-full
mongodb://USER:PASSWORD@mongodb.denizlg24.com:27018/DB?authSource=admin&tls=true
rediss://default:PASSWORD@redis.denizlg24.com:6381
```

Let's Encrypt is publicly trusted, so the OS CA store suffices. Strict TLS-only
enforcement stays deferred until dependents have migrated.

After any change here, verify from a non-tailnet network that existing plaintext
clients still connect on 5433, 27018 and 6380. Keep credentials out of shell
history.
