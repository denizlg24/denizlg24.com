# Pi network and database hardening

Apply these steps from a working Tailscale SSH session while keeping a second
session open. They do not switch Cloudflare ingress or stop the old stack.

## Cloudflare Tunnel

At cutover, plan 012 adds this ingress before the terminal catch-all:

```yaml
ingress:
  - hostname: api.denizlg24.com
    service: http://localhost:3001
  # Preserve every current rule here until plan 012 performs the switch.
  - service: http_status:404
```

The API compose port is pinned to `127.0.0.1:3001` by default. Do not remove or
change the existing `storage`, `cloud`, or `search` tunnel rules during plan
011; plan 012 owns that cutover list.

Validate without replacing the running tunnel:

```sh
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://api.denizlg24.com
```

## UFW

Review `apply-firewall.sh`, then run it from the Pi:

```sh
sudo bash infra/network/apply-firewall.sh
sudo ufw status numbered
```

Expected policy:

- all traffic arriving on `tailscale0` is allowed;
- WAN SSH on 22 is rate-limited as the break-glass route;
- existing public database ports 5433, 27018, and 6380 remain open;
- 3001 and 3003 are denied from WAN;
- Redis TLS on 6381 is opened only with
  `sudo ENABLE_REDIS_TLS_PORT=true bash infra/network/apply-firewall.sh`.

The script does not change the default policy or enable UFW. If UFW is not
already enabled, confirm the above rules and both Tailscale and WAN SSH paths
before running `sudo ufw enable`.

## fail2ban

The compose file sends the three database security logs to journald. Redis
does not emit failed AUTH attempts to stderr, so the unprivileged
`redis-acl-audit` sidecar converts Redis `ACL LOG` auth entries into journal
events without access to the Docker socket.

Install and validate:

```sh
sudo apt update
sudo apt install fail2ban
sudo install -m 644 infra/fail2ban/filter.d/*.conf /etc/fail2ban/filter.d/
sudo install -m 644 infra/fail2ban/jail.d/deniz-cloud.conf /etc/fail2ban/jail.d/
sudo fail2ban-regex infra/fail2ban/samples/postgres.log infra/fail2ban/filter.d/deniz-cloud-postgres.conf
sudo fail2ban-regex infra/fail2ban/samples/mongodb.log infra/fail2ban/filter.d/deniz-cloud-mongodb.conf
sudo fail2ban-regex infra/fail2ban/samples/redis.log infra/fail2ban/filter.d/deniz-cloud-redis.conf
sudo fail2ban-client -t
sudo systemctl enable --now fail2ban
sudo fail2ban-client status
```

Each regex command must report one match. The jail configuration ignores
loopback, the full Tailscale CGNAT range, and the approved home LAN
`192.168.1.0/24`. It uses a conservative six failures in ten minutes and a
one-hour ban; sshd uses five failures.

After the new compose stack is running, make one deliberate failed login to
each staging database and confirm:

```sh
sudo journalctl --since -5min | grep -E 'password authentication failed|Authentication failed|deniz-cloud redis authentication failed'
sudo fail2ban-client status deniz-cloud-postgres
sudo fail2ban-client status deniz-cloud-mongodb
sudo fail2ban-client status deniz-cloud-redis
```

Do not test bans from the sole remote-access address.

## Accept-both database TLS

Install the host units first, then add `LETSENCRYPT_EMAIL` to
`/etc/deniz-cloud/ddns.env` and run:

```sh
sudo apt install certbot python3-certbot-dns-cloudflare
sudo /usr/local/lib/deniz-cloud/provision-db-certs.sh
sudo systemctl enable --now cloud-db-cert-renew.timer
```

The script reuses the Cloudflare DNS API token without printing it, issues one
SAN certificate for the three public database hostnames, and writes
service-specific files below `/etc/deniz-cloud/tls`. The twice-daily systemd
timer renews and deploys it.

After certificate provisioning, set these values in `.env.pi`:

```dotenv
POSTGRES_TLS_MODE=on
MONGO_TLS_MODE=allowTLS
REDIS_TLS_MODE=allow
```

Then recreate only the new stack during its approved deployment window.
PostgreSQL and MongoDB negotiate TLS on their existing ports while still
accepting plaintext. Redis retains plaintext 6380 and adds TLS 6381.

Client opt-in examples:

```text
postgresql://USER:PASSWORD@postgres.denizlg24.com:5433/DB?sslmode=verify-full
mongodb://USER:PASSWORD@mongodb.denizlg24.com:27018/DB?authSource=admin&tls=true
rediss://default:PASSWORD@redis.denizlg24.com:6381
```

Use the operating system CA store; Let's Encrypt is publicly trusted. Strict
TLS-only rules are intentionally deferred until after cutover and dependent
client migration.

## External acceptance test

From a non-tailnet network, verify current plaintext clients still connect on
5433, 27018, and 6380. When optional TLS is enabled, repeat with the three
opt-in strings above. Never place real credentials in shell history; load them
from a temporary local environment file or the client password prompt.
