# Cutover rehearsal — 2026-07-25

First end-to-end rehearsal of the plan 012 migration sequence. Run against a
**Postgres-only staging stack on the Pi**, restored from a live production dump.
Production was never written to.

## Environment

| | |
|---|---|
| Host | `pi-cloud` (Pi 5, 3.9 GiB RAM), reached over Tailscale SSH |
| Staging | compose project `cloud-staging`, Postgres only, `127.0.0.1:15433` |
| Staging data | `/opt/deniz-cloud/staging/data/postgres` (`/srv` is root-owned) |
| Runtime | `ghcr.io/denizlg24/deniz-cloud-api:31fc4a5` (bun 1.3.3), scripts bundled with `bun build --target bun` and mounted |
| Secrets | `.env.staging` derived from `.env.pi`; all crypto keys verified byte-identical |

Production stayed up throughout (`deniz-cloud-*` containers untouched). The only
production reads were one `pg_dump` (MVCC snapshot, no blocking locks), a
read-only mount of `/mnt/ssd/storage` and `/mnt/hdd/storage`, and read-only
`getKey` calls against the live Meilisearch.

Memory: staging Postgres added ~100 MiB against 2.4 GiB available. The full
staging stack (~1.5 GiB capped) was deliberately **not** brought up — with zero
swap configured, co-running it alongside an uncapped production stack risks an
OOM kill landing on a production container.

## Sequence executed

| Step | Result |
|------|--------|
| `pg_dump` prod → restore staging | 95 KB dump; all 13 tables row-count identical |
| `apply-migrations --baseline 0000_serious_spiral` | recorded, not executed |
| `apply-migrations --execute` | applied `0001`–`0004` |
| `inventory-dependents --report` | 17 projects, 22 provisioned DBs, 264-line change list |
| `migrate-users --execute` | 7 users, 6 credentials carried, 7 require TOTP re-enrollment |
| `migrate-s3-legacy --execute` | `created` |
| `migrate-verify` | 6 PASS, 2 SKIP, 3 FAIL |

Data volumes are small (9.6 MB cloud DB), so every step completed in seconds.
**These timings do not bound the real window** — the cutover also stops/starts
containers, switches ingress and waits on DNS, none of which was rehearsed here.

## Bugs found and fixed

1. **`apply-migrations` could not run at all against a real database.**
   Production's schema was built by the old system, so drizzle has no record of
   it. With an empty migrations table the script tried to execute
   `0000_serious_spiral` from scratch and died on
   `CREATE TYPE "public"."collection_source_type"` — the type already exists.
   **This would have failed during the cutover window at runbook step 4.**
   Fixed by adding `--baseline <tag>`, which records migrations as applied
   without executing them, using drizzle's own contract
   (`hash = sha256(<file>)`, `created_at = journal.when`).

2. **`migrate-verify` join was invalid.** Legacy `users.id` is `uuid`; Better
   Auth `auth_user.id` is `text`. Postgres has no `uuid = text` operator, so
   `users-migrated` and `passwords-carried` both failed with a query error
   rather than a real verdict — the two checks that most directly guard
   invariant 5. Fixed with an explicit `::text` cast on both joins.

Both fixes are covered by the existing typecheck/lint/test pass.

## Verify results

**PASS (6)** — `users-migrated` (7), `passwords-carried` (hashes byte-identical),
`totp-unenrolled`, `legacy-s3-credential` (created and decrypts under the
configured key), `project-surface` (17 projects / 7 API keys / 1 S3 credential),
`files-on-disk` (**12/142 sampled files present with valid checksums against
real production storage** — invariant 3 genuinely exercised).

**SKIP (2)** — `sample-password-verifies` and `share-token` need operator-supplied
input (`VERIFY_SAMPLE_USERNAME`/`_PASSWORD`, a pre-cutover `VERIFY_SHARE_TOKEN`).
Both must be supplied for the real run.

**FAIL (3)** — two are genuine production data problems, one is an artifact:

### 1. MongoDB→Meilisearch sync has been broken for ~2 months (production)

All three collections are in `sync_status = error`:

| Collection | Resume token | Last synced | Documents |
|-----------|--------------|-------------|-----------|
| `foods` | **MISSING** | 2026-05-17 | 2,085,600 |
| `urlv3` | present | 2026-05-30 | 12,184 |
| `qrcodev2` | present | 2026-05-29 | 442 |

`foods` has no resume token, so at cutover it would **full-resync 2.08 million
documents** on a 4 GB Pi. That directly violates invariant 2 and is a serious
load event to walk into blind. This is pre-existing and independent of the
rewrite — worth fixing before the window regardless.

### 2. Dangling Meilisearch key (production)

Project `shortn-v2` holds `meili_api_key_uid = 190e8bcb-5531-42cb-a084-3d103a8c9f8e`
in Postgres, but that key no longer exists in Meilisearch. Its search would fail
after cutover. (`deniz-nutrition-api`'s key validates fine.)

### 3. `seeded-tasks` — expected artifact

`metrics_rollup` is seeded at API start, and the API was never booted in a
Postgres-only staging. Not a defect; it cannot pass in this configuration.

## Not covered by this rehearsal

- full stack bring-up, the mixed-protocol load pass, and recorded memory peaks
  (011's outstanding items — blocked on swap or on capping production)
- `pre-cutover-snapshot --execute` (needs Docker access and the real backup dir)
- Mongo, Redis, Meilisearch and the API container in staging
- ingress switch, DNS, Vercel domains
- the "Cloud unreachable" degraded state and storage's >300-row windowed list

---

# Part 2 — production schema migration + first full-stack boot (same day)

Production migrations were applied for real, and the whole new stack was booted
for the first time in `cloud-staging`. Four more production-blocking bugs
surfaced; all are fixed in this commit.

## Production schema migration (done)

Snapshot `denizcloud` (95 KB, sha256 recorded, `pg_restore -l` verified) →
`--baseline 0000_serious_spiral` → applied `0001`–`0004`. Post-state
`pending: []`. Legacy counts unchanged (users=7, projects=17, files=142,
api_keys=7); old admin and storage kept answering 200 throughout.

Only `denizcloud` was snapshotted, not `pg_dumpall`: a full dump is 1,983 MB, of
which 1,752 MB is `proj_deniz_nutrition_api`, which these migrations never
touch. The full dump still belongs in the real window, behind the freeze.

`migrate-users` was deliberately **not** run on production. It is
marker-idempotent, so running it early would freeze user state as of now and
block a re-run if any password changes before cutover. It must run inside the
window, before the new API's first boot.

## Bugs found by the first full-stack boot

3. **`docker-proxy` crash-looped under `read_only: true`.** Its entrypoint
   renders `/usr/local/etc/haproxy/haproxy.cfg` on every start. `read_only`
   blocks the write; a tmpfs over that directory instead hides the template that
   ships there. Both crash-loop. Fixed by dropping `read_only` for that service
   only — the read-only socket mount, `ALLOW_*` allowlist and absent
   capabilities carry the hardening. **The entire ops plane** (container stats,
   restarts, backups, reboot) runs through this proxy.

4. **`mongot` could never become healthy.** `scripts/mongot.yml` binds
   `healthCheck.address` to `mongot:8080` (the container's service IP), but the
   compose healthcheck probed `http://localhost:8080/ready` — connection refused
   forever (`exit=7`, 20 restarts). Because `api` declares
   `depends_on: mongot: condition: service_healthy`, **the production API could
   never have started.** Fixed the probe to match the configured address and
   raised `start_period` to 60s for JVM cold start.

5. **The API crashed on every `/api/*` request under `read_only: true`.**
   `docker diff` showed it writing
   `/home/bun/.bun/install/cache/@opentelemetry/api@1.9.1/...`: the runtime image
   ships only `dist/` with no `node_modules`, so a transitive optional dependency
   bun had left external was being **auto-installed from npm at first request** —
   meaning production also needed live npm egress to serve its first request.
   Fixed at the root by adding `@opentelemetry/api` as an explicit dependency so
   it bundles (verified locally: no bare specifier remains in `dist/index.js`).
   `read_only` is left off until a freshly built image is confirmed to serve
   `/api/*` with it on.

## Operational finding: the healthcheck lies about readiness

`createRuntimeApp()` is **lazily initialised on the first `/api/*` request**, and
`/healthz` sits outside `/api/*`. A container therefore reports **healthy while
having done none of its startup work** — no task seeding, no Redis ACL
reconciliation, no sync workers, no metrics sampler, and no legacy S3 credential
creation.

Confirmed empirically: immediately after boot, `scheduled_tasks` held only the
three restored legacy rows and Redis had one ACL entry. After a single
`/api/me`, `metrics_rollup` (enabled, `*/5 * * * *`) and `tiering_pass`
(disabled) appeared and Redis ACLs went 1 → 4.

**The runbook must issue an `/api/*` request after starting the new stack and
verify seeding before declaring success.** Otherwise a runtime that fails to
initialise looks perfectly healthy until real traffic arrives.

## Cutover blocker for the operator: MongoDB keyfile

`.env.pi` sets `MONGO_REPLICA_KEY_FILE=/etc/deniz-cloud/mongo/replica-keyfile`,
but production's live keyfile is
`/home/denizlg24/deniz-cloud/config/mongo/replica-keyfile` (root:root, 0400).
At cutover the new stack reuses production's `/mnt/ssd/mongo` data dir in place;
mounting a *different* keyfile means mongod cannot authenticate to its own
replica set and will not start. Before the window (needs sudo):

```bash
sudo install -d -m 700 /etc/deniz-cloud/mongo
sudo cp /home/denizlg24/deniz-cloud/config/mongo/replica-keyfile \
        /etc/deniz-cloud/mongo/replica-keyfile
sudo chmod 400 /etc/deniz-cloud/mongo/replica-keyfile
```

A freshly generated keyfile is correct only for staging, which has its own empty
data dir and its own replica set.

## Final staging verify — 7 PASS / 2 SKIP / 2 FAIL

`users-migrated`, `passwords-carried`, `totp-unenrolled`, `legacy-s3-credential`,
`project-surface`, `files-on-disk` (12/142 sampled against real production
storage) and `seeded-tasks` (`metrics_rollup` enabled, `tiering_pass` disabled)
all pass. The two failures are the pre-existing production data issues in Part 1;
the operator has accepted the `foods` re-index as non-critical.

## Follow-ups before the window

1. Fix or accept the `foods` full-resync; decide whether to pre-seed a resume token.
2. Reissue or clear `shortn-v2`'s Meilisearch key.
3. Rotate `MEILI_MASTER_KEY` or `POSTGRES_PASSWORD` — they are currently the
   **same value** in `.env.pi`.
4. Supply `VERIFY_SAMPLE_*` and a pre-cutover `VERIFY_SHARE_TOKEN`.
5. Add swap (or cap production) before any full-stack staging bring-up.
6. Add `--baseline 0000_serious_spiral` as an explicit step in `RUNBOOK.md` §4.
