# deniz-cloud infrastructure

Plan 011 prepares the Raspberry Pi deployment without touching the old running
stack. Production activation remains an explicit plan 012 cutover action.

## Layout

- `compose/`: production compose, examples, database entrypoints, and isolated
  staging configuration.
- `tailscale/`: remote-access lifeline and the passed off-LAN gate record.
- `systemd/`: terminal, reboot sentinel, DDNS, and certificate renewal units.
- `scripts/`: host installation, staging rehearsal, DDNS, and TLS helpers.
- `network/` and `fail2ban/`: UFW, Cloudflare Tunnel, and database/SSH jails.
- `vercel/`: the two Vercel project setup gate.

## Production bootstrap

Run these only on the Pi, without stopping the old compose project:

```sh
sudo install -d -o pi -g pi /opt/deniz-cloud
sudo cp -a infra /opt/deniz-cloud/
cd /opt/deniz-cloud/infra/compose
cp .env.pi.example .env.pi
chmod 600 .env.pi
```

Replace every placeholder secret and, most importantly, replace each data path
with the exact bind-mount source used by the old stack. Do not run production
`compose up` before plan 012. Keep the Mongo member name `mongodb:27017`, the
replica set `rs0`, and the existing replica keyfile.

Authenticate the Pi to GHCR with a read-only package token, then install the
host assets:

```sh
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u denizlg24 --password-stdin
sudo bash /opt/deniz-cloud/infra/scripts/install-host-units.sh
```

Create `/etc/deniz-cloud/ddns.env` with mode 600:

```dotenv
CF_API_TOKEN=replace-with-a-zone-dns-edit-token
CF_ZONE_ID=replace-with-the-zone-id
DDNS_RECORDS=mongodb.denizlg24.com,postgres.denizlg24.com,redis.denizlg24.com,me.denizlg24.com
LETSENCRYPT_EMAIL=replace-with-operator-email
```

The Cloudflare token must be restricted to DNS edit/read for the one zone.
Start the DDNS timer only after its one-shot succeeds:

```sh
sudo systemctl start cloud-ddns.service
sudo systemctl enable --now cloud-ddns.timer
```

The reboot sentinel contract for plan 006 is
`/var/lib/deniz-cloud/reboot-requested`. The API bind-mounts that directory at
`/host-control` and writes `/host-control/reboot-requested`; the host path unit
deletes it before invoking `systemctl reboot`.

The API talks to Docker only through `tcp://docker-proxy:2375`. The proxy
allows container list/inspect/stats, exec, and restart requests; it does not
expose images, networks, volumes, secrets, services, or the system endpoint.
PostgreSQL and MongoDB backup artifacts keep the legacy paths below
`BACKUP_DIR/postgres` and `BACKUP_DIR/mongodb`. File backups are tar archives
below `BACKUP_DIR/files`.

### Host terminal service

The terminal is a compiled host service, never a container. Install `tmux`,
then install the plan 011 ARM64 artifact and configure the shared secret:

```sh
sudo apt-get install tmux
sudo install -o root -g root -m 0755 cloud-terminal \
  /usr/local/bin/cloud-terminal
sudo install -o root -g root -m 0600 \
  /etc/deniz-cloud/terminal.env.example \
  /etc/deniz-cloud/terminal.env
sudoedit /etc/deniz-cloud/terminal.env
sudo systemctl enable --now cloud-terminal.service
sudo systemctl status cloud-terminal.service
ss -ltn | grep '127.0.0.1:3003'
```

`TERMINAL_TICKET_SECRET` must be the same random value (at least 32 bytes) in
the API compose environment and `/etc/deniz-cloud/terminal.env`. The unit runs
as the dedicated `pi-terminal` account, has no sudo policy, rejects non-loopback
bind addresses, and is hardened with `NoNewPrivileges` and
`ProtectSystem=strict`. `KillMode=process` deliberately leaves only that
unprivileged user's tmux server alive across daemon restarts; its socket is
under `/var/lib/cloud-terminal`, one of the unit's two writable paths.

tmux sessions use the `cloud-` prefix, retain 100,000 history lines, and are
reaped when unattached and inactive for `SESSION_IDLE_HOURS` (24 by default).
List or kill them through the authenticated API, not by publishing port 3003.

## Compose validation

```sh
docker compose \
  --env-file infra/compose/.env.pi.example \
  -f infra/compose/docker-compose.pi.yml \
  config -q
```

Adminer and mongo-express are in the `tools` profile and bind only to loopback:

```sh
docker compose --env-file .env.pi -f docker-compose.pi.yml \
  --profile tools up -d adminer mongo-express
```

Access them through an SSH tunnel; never publish them on WAN.

## Memory budget

The default core cgroup limits total 1,530 MiB (about 1.49 GiB). The optional
loopback database tools add 112 MiB.

| Service | Limit | Staging peak | OOM kills |
|---|---:|---:|---:|
| API | 450 MiB | pending plan 006/004/005 load pass | pending |
| MongoDB | 384 MiB | pending | pending |
| mongot | 192 MiB | pending | pending |
| PostgreSQL | 192 MiB | pending | pending |
| Redis | 144 MiB | pending | pending |
| Redis ACL audit | 16 MiB | pending | pending |
| Meilisearch | 128 MiB | pending | pending |
| Docker socket proxy | 24 MiB | pending | pending |
| **Core total** | **1,530 MiB** | **pending** | **pending** |

Mongo's WiredTiger cache defaults to 0.25 GiB and mongot's JVM to a 128 MiB
maximum within those cgroups. The required scripted load pass and observed
peaks cannot be completed until plans 004–006 supply the TUS, S3, search, and
dashboard/metrics endpoints; run it on the Pi staging project before plan 011
is marked DONE.

## Staging rehearsal

Staging uses project name `cloud-staging`, loopback ports 13001/15433/17018/
16380/16381, and paths below `/srv/deniz-cloud-staging`. It cannot replace or
bind the production database ports.

```sh
cd /opt/deniz-cloud/infra/compose
cp .env.staging.example .env.staging
chmod 600 .env.staging
# Replace every staging placeholder before starting.
sudo ../scripts/staging-up.sh
docker compose -p cloud-staging --env-file .env.staging \
  -f docker-compose.pi.yml ps
curl --fail http://127.0.0.1:13001/healthz
sudo ../scripts/staging-down.sh
```

`staging-down.sh` removes containers, the staging network, and the named mongot
secret volume. It deliberately leaves bind-mounted staging data for inspection
and rehearsal reuse.

## Release workflow and rollback

`release-cloud.yml` uses the native `ubuntu-24.04-arm` runner and pushes both
the immutable Git SHA and `latest` to
`ghcr.io/denizlg24/deniz-cloud-api`. The `pi` GitHub environment must have
required-reviewer protection plus:

- secrets `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET`;
- variable `PI_TAILNET_HOST=pi-cloud`;
- a Tailscale `tag:ci` grant permitting TCP/22 to `pi-cloud` and
  Tailscale SSH as user `pi`.

Never approve the production deploy job before plan 012's cutover window. The
job copies only versioned infrastructure assets, preserves `.env.pi`, deploys
the immutable image, and waits for `/healthz` to report that exact SHA.

Rollback is non-destructive: manually run the workflow with `image_tag` set to
the last known-good SHA tag and approve the `pi` environment. The compose
bind-mounts remain unchanged. If the health gate fails, inspect the new
container without pruning images or volumes, then deploy the previous SHA.

Terminal compilation and installation are deferred until plan 007 creates the
workspace. Extend this same workflow with the required
`bun build --compile --target=bun-linux-arm64` artifact at plan 011
finalization.

## Health integration

Configure the existing web resource with:

- public HTTP check: `https://api.denizlg24.com/healthz`, expected status 200,
  JSON path `status`, expected value `ok`;
- TCP sub-resources for the three public database hostnames and ports.

The component endpoint is `GET https://api.denizlg24.com/api/ops/health`.
It requires a Better Auth superuser session and returns paths such as
`data.checks.postgres.status`, `data.checks.mongodb.status`,
`data.checks.redis.status`, `data.checks.meilisearch.status`,
`data.checks.mongot.status`, `data.checks.disk.status`, and
`data.checks.tunnel.status`; healthy values are `ok`.

The current `apps/web` HTTP sub-resource model cannot attach an authenticated
cookie or header. Keep the public aggregate and TCP checks active for now.
When that model gains secret headers, point private component checks at the
paths above with a superuser-authenticated relay. Do not put session or API
credentials in a check URL.

No web application changes belong to plan 011.
