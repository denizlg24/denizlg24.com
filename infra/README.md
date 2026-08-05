# deniz-cloud infrastructure

The stack is live: `api.denizlg24.com` on the Pi, `cloud.` and `storage.` on
Vercel. This describes what runs and how to operate it. Historical planning and
the cutover runbooks live in `docs/internal/` (untracked).

## Layout

- `compose/` — production compose, env examples, database entrypoints.
- `systemd/` — terminal, reboot sentinel, DDNS, certificate renewal units.
- `scripts/` — host install, DDNS, TLS helpers.
- `network/`, `fail2ban/` — UFW, Cloudflare Tunnel, database/SSH jails.
- `tailscale/`, `vercel/` — remote access and the two Vercel projects.

Deployed copy lives at `/opt/deniz-cloud/infra` on the Pi. `.env.pi` (mode 600)
exists only there.

## Deploy

Push to `main`; CI builds `ghcr.io/denizlg24/deniz-cloud-api` for arm64. Then on
the Pi:

```sh
cd /opt/deniz-cloud/infra/compose
docker compose -p deniz-cloud --env-file .env.pi -f docker-compose.pi.yml \
  --profile tools up -d
```

Compose changes must be copied to the Pi as well — only the image ships through
CI. Validate before deploying:

```sh
docker compose --env-file infra/compose/.env.pi.example \
  -f infra/compose/docker-compose.pi.yml config -q
```

**A healthy container is not a ready one.** The runtime is built lazily on the
first `/api/*` request and `/healthz` sits outside `/api/*`, so a container
reports healthy having seeded no tasks, reconciled no Redis ACLs and started no
workers. After every deploy:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://api.denizlg24.com/api/me   # 401
docker exec deniz-cloud-postgres-1 psql -U admin -d denizcloud -t -A -F'|' \
  -c "SELECT type, enabled FROM scheduled_tasks WHERE type IN ('metrics_rollup','tiering_pass')"
```

Expect `metrics_rollup|t` and `tiering_pass|f`.

Rollback: re-run the release workflow with `image_tag` set to the last good SHA.
Bind mounts are untouched, so this is non-destructive. Do not prune images or
volumes while diagnosing a failed deploy.

## POSIX migration safety tools

Plan 014's pre-migration snapshot is intentionally separate from the scheduled
database backups. It freezes and archives both physical storage branches,
including S3 and upload internals, and captures PostgreSQL, MongoDB, and the
Redis ACL file. The archive keeps xattrs, POSIX ACLs, sparse allocation,
ownership, modes, and timestamps. It also records content/tree manifests and
only the deployed image identifiers; container environments and their secrets
are never copied into evidence.

Run the preflight first. By default, `--execute` refuses to proceed while the
API is running. When the operator can guarantee that no storage mutations will
occur for the duration, `--allow-live-api` records that explicit exception in
the manifest while leaving the API available:

```sh
infra/scripts/posix-gate0-snapshot.sh --dry-run --allow-live-api
infra/scripts/posix-gate0-snapshot.sh --execute --allow-live-api
```

The live exception is not a database-wide freeze: unrelated session, metric,
and scheduler rows may continue changing, while each database dump remains
individually consistent. The archive/manifests still fail verification if
namespace bytes change during capture. The completed snapshot is private
rollback material: it contains database role hashes and the Redis ACL, so keep
its directory mode `0700`, transfer it only over the tailnet, and never commit
it. Verify restoration on the Pi without touching either live branch:

```sh
sudo infra/scripts/posix-gate0-restore-verify.sh --execute \
  /mnt/hdd/backups/posix-gate0-YYYYMMDDTHHMMSSZ
```

The verifier creates disposable loopback ext4 files and isolated database
containers with networking disabled, compares the restored trees and every
file checksum, writes `restore-proof.json`, then removes its temporary mounts,
loop devices, containers, and volumes. Copy the completed snapshot off the Pi
and run `sha256sum -c SHA256SUMS` again at the destination before treating Gate
0 as backed up.

### Disposable POSIX/Samba Gate 1

Gate 1 never mounts a production storage branch. It creates sparse loopback
ext4 images below `/var/lib/deniz-cloud/posix-gate1`, joins only those images
with mergerfs, and starts an isolated `smbd` bound to the Pi's Tailscale IPv4
address. The normal Samba units remain masked. The production API stays online
throughout this spike.

Install the pinned host dependencies first:

```sh
infra/scripts/posix-gate1-install.sh --dry-run
sudo infra/scripts/posix-gate1-install.sh --execute
infra/scripts/posix-gate1-preflight.sh
```

The installer simulates the complete APT transaction before it masks Samba or
installs anything. If Noble libraries are already at an updates-pocket version
but `noble-updates` is no longer enabled, restore that Ubuntu source and rerun
the installer; do not downgrade `libacl1` or `libattr1`.

Build the API probes, then copy this exact layout to the Pi so the lifecycle
script can resolve its template and bundles without environment overrides:

```sh
bun run --cwd apps/api build
ssh pi-cloud 'install -d -m 700 /tmp/posix-gate1-kit/infra/scripts \
  /tmp/posix-gate1-kit/infra/samba /tmp/posix-gate1-kit/apps/api/dist'
scp infra/scripts/posix-gate1-spike.sh \
  infra/scripts/posix-gate1-metadata.sh \
  infra/scripts/posix-gate1-peer-container.sh \
  infra/scripts/posix-gate1-tier-crash.sh \
  pi-cloud:/tmp/posix-gate1-kit/infra/scripts/
scp infra/samba/posix-gate1-smb.conf.in \
  pi-cloud:/tmp/posix-gate1-kit/infra/samba/
scp apps/api/dist/posix-gate1-probe.js \
  apps/api/dist/posix-gate1-slow-client.js \
  pi-cloud:/tmp/posix-gate1-kit/apps/api/dist/
scp apps/api/dist/posix-gate1-peer.js pi-cloud:/tmp/posix-gate1-peer.js
```

Every mutating lifecycle command requires both `sudo` and `--execute`:

```sh
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute prepare
# This intentionally requires the prepared phase, before Samba starts.
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute branch-loss-test
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute start-samba
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute host-test
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute api-test
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-tier-crash.sh --execute
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute watchdog
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute status
```

Run the fail-closed checks only against this disposable spike. `watchdog` is a
bounded, one-shot health check suitable for repeated scheduling. The destructive
branch-loss probe requires the `prepared` phase with Samba stopped; it unmounts
only the exact marked HDD loopback branch, withdraws the disposable mergerfs
namespace, restores the branch, and compares the exact marker hashes:

```sh
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute watchdog
# Run only after an actual host reboot:
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute reboot-check
```

Exit 10 means the disposable namespace was safely withdrawn or a required STOP
remains; exit 20 means fail-closed behavior could not be proven. A reboot check
never claims marker preservation from resource absence alone: it stays
quarantined until the loopback branches are remounted and their markers are
verified. These checks always report `gate1Passed:false` and never touch a
production mount.

`host-test` and `api-test` are explicitly partial. They prove deterministic
SSD/HDD placement, xattr/ACL/backup behavior, encrypted SMB round trips,
highest-level container binding, Bun full/Range/TUS behavior, a 5.8 GB sparse
slow-client shape, and bounded RSS. They do **not** pass Gate 1. Native
Finder/Explorer behavior, protected-EA access, link creation, open-handle
API↔SMB concurrency, live branch loss/reboot, tier-move crash points, and
LAN/relay performance remain mandatory STOP-or-pass checks.

The client probes use OS credential prompts and keep evidence private:

```sh
infra/scripts/posix-gate1-macos.sh --dry-run --host 100.89.155.9 --share Personal
# PowerShell concurrency adds the validated Pi SSH endpoint and never forwards
# the SMB credential:
# .\posix-gate1-windows.ps1 --dry-run --host 100.89.155.9 --share Personal --ssh-host denizlg24@pi-cloud
```

The tier-crash probe uses only the loopback branches. It verifies exact bytes
and stable xattrs while simulating interruption during copy, after destination
fsync, after atomic publish, before source unlink, and during reverse promotion.
Its result is intentionally partial; the production recovery implementation and
an actual reboot-during-copy check remain later gates.

The protected-xattr adversary is separate because an accepted reserved stream
name is a Gate 1 failure even when Samba stores it under `user.DosStream.*`
instead of overwriting the raw xattr. Prepare one exact marked directory under
the disposable Personal share, seed protected metadata, then run the encrypted
SMB attack. Its auth file is environment-only and never appears in evidence:

```sh
run_id="$(cat /proc/sys/kernel/random/uuid)"
metadata_root="/var/lib/deniz-cloud/posix-gate1/mounts/merged/personal/posix-gate1-metadata-${run_id}"
metadata_evidence="/var/lib/deniz-cloud/posix-gate1/evidence/metadata-${run_id}.jsonl"
sudo -u '#1000' mkdir -m 700 "$metadata_root"
printf 'deniz-cloud-posix-gate1-metadata:%s\n' "$run_id" \
  | sudo -u '#1000' tee "$metadata_root/.posix-gate1-metadata" >/dev/null
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-metadata.sh --execute \
  --action seed --root "$metadata_root" --run-id "$run_id" \
  --evidence "$metadata_evidence"
sudo env POSIX_GATE1_SMB_HOST=100.89.155.9 POSIX_GATE1_SMB_SHARE=Personal \
  POSIX_GATE1_SMB_AUTH_FILE=/var/lib/deniz-cloud/posix-gate1/samba/client.auth \
  /tmp/posix-gate1-kit/infra/scripts/posix-gate1-metadata.sh --execute \
  --action smb-adversarial --root "$metadata_root" --run-id "$run_id" \
  --evidence "$metadata_evidence"
```

The result distinguishes the raw protected attributes from a client-created
reserved-name stream alias, validates the `fruit:resource=file` AppleDouble
magic, checks that the `._` sidecar is hidden over SMB, and proves whether a
normal SMB copy carries protected metadata. A reserved-name stream write,
protected-value read, copied protected xattr, visible AppleDouble sidecar, or
unexpected/special namespace entry leaves `allGreen:false` and exits nonzero.

Cleanup is two explicit steps so evidence can be copied before destruction:

```sh
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute stop
sudo /tmp/posix-gate1-kit/infra/scripts/posix-gate1-spike.sh --execute destroy
```

`destroy` accepts only the exact marked disposable root after every mount and
loop device has been removed. It is irreversible for the disposable spike and
never targets the production namespace.

## Host services

**Terminal** is a compiled binary, never a container, and CI does not ship it:

```sh
bun build apps/terminal/src/index.ts --compile --target=bun-linux-arm64 \
  --outfile cloud-terminal
sudo install -m 755 -o root -g root cloud-terminal /usr/local/bin/cloud-terminal
sudo systemctl restart cloud-terminal
```

It runs **as root** (operator decision — it is the primary remote administration
path), which requires `TERMINAL_ALLOW_ROOT=1` in the unit; the daemon refuses
uid 0 without it. It still rejects wildcard and publicly routable binds.
`TERMINAL_TICKET_SECRET` must be byte-identical in `.env.pi` and
`/etc/deniz-cloud/terminal.env`. `KillMode=process` keeps the tmux server alive
across daemon restarts; sessions use the `cloud-` prefix and are reaped after
`SESSION_IDLE_HOURS` (24).

The API reaches the terminal over the host's Tailscale address, not
`host.docker.internal` — Docker's inter-bridge isolation makes the docker0
gateway unroutable from the compose network, and UFW's `INPUT` policy is `DROP`,
so this rule is required:

```sh
sudo ufw allow from 172.16.0.0/12 to any port 3003 proto tcp
```

**Reboot sentinel**: the API writes `/host-control/reboot-requested`; the host
path unit deletes it and calls `systemctl reboot`. Source dir is
`/var/lib/deniz-cloud`, and it must be owned by uid 1000 — the container writes
the sentinel as the unprivileged `bun` user, so a root-owned directory fails
every `reboot_server` task with `EACCES`. `install-host-units.sh` creates it that
way; a host provisioned before that:

```sh
sudo chown 1000:1000 /var/lib/deniz-cloud
```

**Docker access** is only ever through `tcp://docker-proxy:2375`, which permits
container list/inspect/stats, exec and restart — no images, networks, volumes or
secrets. The proxy cannot run `read_only`: its entrypoint renders
`haproxy.cfg` at start, and a tmpfs over that directory hides the template.

**MongoDB keyfile** is `/etc/deniz-cloud/mongo/replica-keyfile` (root, 0400).
It must match the data directory's replica set or mongod will not start. Member
name stays `mongodb:27017`, replica set `rs0`.

**Storage files must be owned by uid 1000.** The API runs unprivileged as `bun`;
anything root-owned makes deletes, renames and uploads fail `EACCES` while reads
keep working.

## Memory

The API is capped at 1200 MiB. Everything else runs uncapped but internally
bounded: PostgreSQL `shared_buffers=64MB`, WiredTiger 0.25 GiB, mongot
`-Xmx128m`, Redis `maxmemory=128mb`. Bun is the only genuinely unbounded
runtime, which is why it is the one with a cgroup limit — an unbounded response
buffer previously triggered a *global* OOM that had the kernel picking Redis as
a victim.

`oom_score_adj` biases the killer away from data: `-500` on postgres and
mongodb, `500` on the API, `1000` on sidecars and tools.

Steady state is roughly 1.5 GiB of 3.9 GiB with the full stack up.

`POSTGRES_MAX_CONNECTIONS` (150) is shared between `DB_POOL_MAX` (25) and every
dependent project connecting directly. Backends cost ~5 MiB each, so a saturated
ceiling is a ~750 MiB commitment. If dependents grow past this, add pgbouncer in
transaction mode rather than raising the ceiling.

`effective_cache_size` allocates nothing — it only tells the planner how much OS
page cache to assume. Tune it separately from the budget above.

## Tools

Adminer and mongo-express are in the `tools` profile, loopback-only, and reached
through the admin app's superuser `/api/ops/tools/*` proxy. Never publish them.

## Health

Public: `https://api.denizlg24.com/healthz` → 200, JSON `status` = `ok`, plus TCP
checks on the three public database hostnames.

Component detail: `GET /api/ops/health` (superuser session) returns
`data.checks.{postgres,mongodb,redis,meilisearch,mongot,disk,tunnel}.status`.
`apps/web`'s HTTP sub-resource model cannot send an authenticated header yet, so
the public aggregate and TCP checks remain the integration. Never put
credentials in a check URL.
