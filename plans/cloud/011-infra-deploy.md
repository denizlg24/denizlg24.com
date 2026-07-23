# Cloud 011: Infra & deploy — Tailscale, images, compose, CI/CD, Vercel

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`. Steps marked **[operator]** need the human (Pi/
> router/dashboard access) — prepare exact instructions/scripts and STOP at
> each until confirmed.

## Status

- **Executor**: gpt5.6 (+ operator for hardware/dashboard steps)
- **Effort**: L
- **Risk**: MED-HIGH (remote-access lifeline; must be done before the operator moves abroad)
- **Depends on**: 001 (start anytime after; finalize compose after 006/007 exist)
- **Category**: infrastructure

## Current state (old repo)

Pi 5 (4GB, Ubuntu Server headless): docker compose (postgres :5433, mongo
:27018 + mongot, redis :6380, meili, storage :3001, admin :3002, adminer,
mongo-express, terminal :3003), cloudflared on host, DDNS cron
(`scripts/infra/ddns-update.sh` updates A records for
mongodb/postgres/redis.denizlg24.com), UFW (22, 5433, 27018, +6380), router
port forwarding. Deploys are manual (ssh + git pull + compose build on the
Pi — slow and risky). CI is checks-only.

## Scope

### 1. Tailscale (the remote-access lifeline — do first)

Author `infra/tailscale/SETUP.md` with exact **[operator]** steps: install
tailscale on Pi; `tailscale up --ssh --advertise-routes=<LAN CIDR>`
(subnet router → whole home network reachable); enable MagicDNS; approve
route + add operator's laptop/phone; **disable key expiry for the Pi** (a
expired key while abroad = lockout); enable Tailscale SSH and verify
`tailscale ssh` from laptop. Document break-glass: router port-forward 22
stays but UFW-limited (see §5), and cloudflared tunnel is an independent
path. Verification: operator confirms SSH over tailnet from off-LAN
(phone hotspot).

### 2. Production compose for the new stack

`infra/compose/docker-compose.pi.yml` (+ `.env.pi.example` documenting every
var; real `.env` lives on the Pi only): postgres:16 (same data volume path
as old — reused in place), mongodb 8.2 + mongot (port
`vendor/deniz-cloud/scripts/infra/{mongodb-entrypoint.sh,mongo-rs-init.sh,
mongot.yml}` into `infra/compose/`), redis:7-alpine (+ ported
`redis-acl-entrypoint.sh` — ACL file volume preserved), meilisearch v1.38+
(same data dir), adminer + mongo-express (internal), docker-socket-proxy
(006 §hardening; api's DOCKER_HOST), and `api` (image from GHCR, mounts:
storage SSD/HDD paths, host /proc /sys ro for metrics, backups dir,
`extra_hosts: host-gateway` for terminal proxy). Memory limits per the old
budget (~1.45GB containers total) adjusted: one api container replaces
storage+admin (300+250 → ~450MB limit). Terminal service + cloudflared are
host-side, NOT compose. Keep published DB ports identical (5433/27018/6380).

### 3. systemd units

`infra/systemd/`: `cloud-terminal.service` (from 007),
`cloud-reboot.path`+`.service` (006's reboot sentinel: path unit watches
sentinel file → `systemctl reboot`), install script
`infra/scripts/install-host-units.sh`. Port `ddns-update.sh` +
its cron/timer into `infra/scripts/` (still needed for DB A-records).

### 4. Images & CI/CD

- `apps/api/Dockerfile` (multi-stage, bun, arm64) built in CI:
  `.github/workflows/release-cloud.yml` on push to main touching
  `apps/api|packages/cloud-core|packages/schemas|infra/**`:
  build linux/arm64 (use `ubuntu-24.04-arm` runner — native, no QEMU),
  push `ghcr.io/denizlg24/deniz-cloud-api:{sha,latest}`.
- Terminal binary: `bun build --compile --target=bun-linux-arm64` artifact
  uploaded + deployed by the same workflow.
- Deploy job (environment `pi`, manual approval gate): connect tailnet via
  `tailscale/github-action` (OAuth secrets), `ssh pi@<tailnet-name>`:
  `docker compose -f ... pull && up -d`, copy terminal binary + systemd
  reload, health-gate: poll `https://api.denizlg24.com/healthz` for new
  version, else exit 1 (compose keeps old containers unless pull succeeded —
  document rollback: re-run deploy with previous sha tag input).
- Extend `ci.yml` only if new workspaces aren't already covered (001 note).

### 5. Network & hardening

Document + script (**[operator]** applies): CF Tunnel ingress for
`api.denizlg24.com` → `localhost:3001` (api container port; pick and pin
one — old used 3001/3002, new api = 3001); retire old
storage/cloud/search tunnel ingress rules AT CUTOVER ONLY (012 owns the
switch list). UFW: allow 22 (rate-limited), 5433, 27018, 6380, tailscale0
interface unrestricted; deny 3001/3003 from WAN (tunnel/local only).
**fail2ban jails for sshd AND the exposed DB ports** (old PLAN.md Phase 4
item, never done — postgres/mongo/redis auth-failure jails; ship jail +
filter configs in `infra/fail2ban/`, conservative bantime, whitelist the
tailnet range and current home LAN). **Optional TLS for exposed DBs** (old
PLAN.md item, never done): enable server TLS in postgres/mongo/redis
configs in **accept-both mode** (`ssl=on` without `hostssl`-only rules /
mongo `allowTLS` / redis TLS port alongside plain) so existing dependents
keep connecting unchanged and can opt into TLS later — cert provisioning
via Let's Encrypt DNS-01 (Cloudflare API token already used by DDNS
script) with a renewal timer; document per-DB client opt-in strings.
Strict-TLS enforcement is a post-cutover follow-up, not part of this
program. Verify DB ports still reachable from a non-tailnet host
(dependents rely on it).

### 6. Vercel projects **[operator]**

Instructions doc: two Vercel projects from this repo (root dirs
`apps/cloud`, `apps/storage`), bun install/build settings matching
`apps/web`'s Vercel setup, env vars (`NEXT_PUBLIC_CLOUD_API_URL=...`),
domains attached but NOT yet switched in DNS (012 flips DNS). Preview
deployments on PRs.

## Verification

```
# CI: release-cloud.yml green on a test branch push (build + ghcr push)
# operator: tailscale ssh from off-LAN works; compose config validates:
docker compose -f infra/compose/docker-compose.pi.yml config -q
bun run format-and-lint
# Deploy dry-run to Pi against a STAGING project name (compose -p cloud-staging
# with alternate ports/volumes from .env.staging) — full stack healthy, then
# torn down. This staging bring-up is the core rehearsal asset for 012.
# Load test (old PLAN.md item, never done): against STAGING on the Pi, run a
# scripted load pass (infra/scripts/load-test.ts: concurrent downloads incl.
# Range, TUS upload, S3 put/get, search queries, dashboard polling) while
# watching container memory — confirm the ~1.45GB budget holds with zero
# OOM kills; record peak numbers in infra/README.md's memory budget table.
```

## STOP conditions

Runbook STOPs, plus: any step that would stop/replace the OLD running stack
before plan 012's cutover window; tailscale subnet route not approvable
(dashboard perms); arm runner unavailability (fall back to QEMU build —
slower, allowed — record it).

## Drift log

- **2026-07-23 (partial, awaiting dependency/operator gates):** Redis 7 does
  not emit failed `AUTH` attempts to its container log, so the Redis fail2ban
  jail is fed by a 16 MiB, socket-less `redis-acl-audit` sidecar that reads and
  clears `ACL LOG`; live verification confirmed the emitted remote-address
  event. Optional Redis TLS is exposed on 6381 alongside unchanged plaintext
  6380. Adminer and mongo-express are loopback-only and opt-in through the
  `tools` compose profile.
- **2026-07-23 (remaining):** Tailscale §1 passed. Plan finalization remains
  gated on plans 004–006 for the endpoint-complete Pi staging rehearsal,
  scripted mixed-protocol load pass, measured memory table, and final
  socket-proxy/reboot environment contract; plan 007 for terminal compilation,
  artifact deployment, and final unit verification; plus the first native
  ARM64 GHCR workflow run and operator application/verification of §5
  network/TLS and §6 Vercel projects. No production stack or DNS was changed.
