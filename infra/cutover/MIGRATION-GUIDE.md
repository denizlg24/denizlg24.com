# Migration script guide

Reference for the five cutover scripts in `apps/api/scripts/`. `RUNBOOK.md` is
the ordered checklist for the window itself; this document explains what each
script does, what it needs, how it fails, and what re-running it does.

---

## Safety model

Every script shares one contract, enforced in `apps/api/scripts/lib/runner.ts`:

| Property | Behaviour |
|----------|-----------|
| Default mode | **Dry run.** `--execute` must be typed deliberately. |
| Conflicting flags | `--dry-run` with `--execute` is an error, not a precedence rule. |
| Unrelated flags | Never imply `--execute` (`--json`, `--live`, `--log` are inert). |
| Output | One machine-readable JSON summary line on **stdout**. |
| Audit trail | Structured JSONL to `--log <path>`; log write failures never abort a run. |
| Re-runs | Guarded by a marker row; a completed step reports `alreadyComplete: true` instead of writing twice. |
| Ordering | A step refuses to run before its predecessor's marker exists. |
| Exit codes | `0` success, `1` runtime failure, `2` bad arguments. |

### Markers

Markers are rows in `auth_verification` with a never-expiring `expiresAt`, so
Better Auth's sweeper leaves them alone.

| Marker | Written by | Identifier |
|--------|-----------|------------|
| `cloud-migration:012-schema` | `apply-migrations.ts` | `cloud-migration:012` |
| `cloud-migration:003-users` | `migrate-users.ts` | `cloud-migration:003` |
| `cloud-migration:012-s3-legacy` | `migrate-s3-legacy.ts` | `cloud-migration:012` |

> The users marker uses plan **003's** identifier because `migrate-users.ts`
> predates this harness. Reading it under 012's identifier silently never
> matches — that mismatch would permanently block the S3 preflight's ordering
> guard. `markerIdentifier()` owns this mapping; do not inline the constant.

Enforced order: **schema → users → s3-legacy**.

### Inspecting markers

```sql
SELECT id, identifier, value, created_at
FROM auth_verification
WHERE identifier IN ('cloud-migration:012', 'cloud-migration:003');
```

Clearing a marker to force a re-run is a deliberate, destructive act — the
underlying step is idempotent, but you lose the "already done" signal the
runbook depends on. Do it only during rehearsal, never in production.

---

## Environment

All scripts load the repo root `.env` via `bun --env-file=../../.env`.

> The root `.env` is CRLF. Anything parsing it outside Bun must normalise
> `\r\n` first or it silently drops every value.

| Variable | Needed by |
|----------|-----------|
| `DATABASE_URL` | all |
| `AUTH_MIGRATION_REPORT_KEY` (≥32 chars) | `migrate-users --execute` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `migrate-s3-legacy`; optional for `migrate-verify` |
| `S3_CREDENTIAL_ENCRYPTION_KEY` (≥32 chars) | `migrate-s3-legacy`, `migrate-verify` |
| `SSD_STORAGE_PATH`, `HDD_STORAGE_PATH`, `JWT_SECRET` | `migrate-s3-legacy`, `migrate-verify` |
| `BACKUP_DIR`, `DOCKER_HOST` | `pre-cutover-snapshot` |
| `POSTGRES_CONTAINER`, `MONGODB_CONTAINER`, `REDIS_CONTAINER`, `REDIS_ACL_FILE` | `pre-cutover-snapshot` (defaults: `postgres`, `mongodb`, `redis`, `/data/users.acl`) |
| `MEILISEARCH_URL` + `MEILI_MASTER_KEY` \| `MEILISEARCH_ADMIN_KEY` | `migrate-verify` (else the key check SKIPs) |
| `VERIFY_SAMPLE_USERNAME`, `VERIFY_SAMPLE_PASSWORD`, `VERIFY_SHARE_TOKEN`, `VERIFY_HEALTH_URL` | `migrate-verify` optional checks |

**Gotcha:** `migrate-s3-legacy` and `migrate-verify` call
`storageConfigFromEnv()`, which validates the *entire* storage config. They will
refuse to start without `SSD_STORAGE_PATH`, `HDD_STORAGE_PATH` and `JWT_SECRET`
even though neither script touches storage paths.

### Secrets that must carry over byte-for-byte

| Variable | Breaks if wrong |
|----------|-----------------|
| `JWT_SECRET` | every share link issued before cutover (invariant 3) |
| `DATABASE_CREDENTIAL_ENCRYPTION_KEY` | every provisioned project DB password — must equal the old `TOTP_ENCRYPTION_KEY` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | every dependent's SigV4 signing (invariant 4) |
| `S3_CREDENTIAL_ENCRYPTION_KEY` | decryption of every stored S3 secret |

---

## `inventory-dependents.ts`

Generates the dependent-project change list from the live database.

```bash
bun run --cwd apps/api cutover:inventory --report infra/cutover/change-list.md
```

**Read-only by construction.** There is no `--execute` path — passing it is an
error — and no query selects a secret column. Key hashes, encrypted passwords,
encrypted S3 secrets and project Meilisearch keys are reported as presence
booleans; access key ids are masked to first/last four.

Reports, per project: provisioned databases (type, db name, username), S3
credentials, API keys (prefix, scopes, expiry, last use), search indexes with
resume-token presence, and the NULL-project legacy credential separately.
Ordered by last credential use, so live consumers sort to the top and dormant
projects are visible as dormant.

| Summary field | Meaning |
|---------------|---------|
| `projects` | total projects found |
| `collectionsMissingResumeToken` | **must be 0** — these would full-resync, breaking invariant 2 |
| `legacyS3Credentials` | NULL-project rows; expect 0 before first boot, 1 after |

---

## `apply-migrations.ts`

Applies the `packages/cloud-core/drizzle` migrations.

```bash
bun run --cwd apps/api cutover:apply-migrations              # lists pending
bun run --cwd apps/api cutover:apply-migrations --execute
```

Dry run reads the journal and the `drizzle.__drizzle_migrations` table and
reports pending tags without connecting for writes. `firstRun: true` means the
migrations table does not exist yet.

After applying, it re-reads the journal and fails if anything is still pending —
a partially-applied migration set will not be reported as success.

> `0004_black_cerebro` adds `run_command` to the `task_type` enum. Without it
> every `run_command` task insert fails, so this must land before the new API
> boots.

---

## `migrate-users.ts`

Plan 003's script, unchanged in contract. Preserves password hashes, marks every
user TOTP-re-enrollment-required, and writes an encrypted operator report.

```bash
bun run --cwd apps/api auth:migrate-users --execute --report "$CUTOVER_LOG/users-report.json"
```

Never imports a legacy TOTP secret and never creates an active
`auth_two_factor` row. Legacy TOTP and recovery rows are left in place purely so
rollback stays clean before the point of no return. **No recovery codes are
distributed from the report** — users receive new backup codes at enrollment.

Must run **before the new API's first boot**: ops task seeding runs only at API
start and no-ops when no superuser row exists.

---

## `migrate-s3-legacy.ts`

Preflight for the NULL-project legacy S3 credential.

```bash
bun run --cwd apps/api cutover:migrate-s3-legacy              # inspect only
bun run --cwd apps/api cutover:migrate-s3-legacy --execute
```

The row is already created idempotently by `ensureLegacyS3Credential` during the
new API's first boot. This script does **not** reimplement that — it runs the
same assertions beforehand, while the old stack is still serving and rollback is
free, plus one check startup cannot do.

| `outcome` | Meaning |
|-----------|---------|
| `would-create` | no row yet; startup (or `--execute`) will create it |
| `would-reuse` | row exists, matches, and decrypts cleanly |
| `created` | this run inserted it |
| `already-correct` | `--execute` found it already valid |

Hard failures — all of which would otherwise surface as a crash loop or as
broken S3 requests during the window:

- access key already assigned to a project (startup would refuse to boot)
- stored secret hash differs from `S3_SECRET_ACCESS_KEY`
- the row is revoked (dependents would start failing SigV4)
- **ciphertext does not decrypt under the configured
  `S3_CREDENTIAL_ENCRYPTION_KEY`** — startup only compares the SHA-256 hash, so
  a row encrypted under a previous key passes there and then fails every signed
  S3 request

`--execute` re-inspects after writing, so a bad encryption key cannot be
committed silently.

---

## `pre-cutover-snapshot.ts`

Captures the rollback asset.

```bash
bun run --cwd apps/api cutover:snapshot                # preflight only
bun run --cwd apps/api cutover:snapshot --execute
```

Reuses plan 006's backup executors rather than shelling out to `pg_dump`, so the
cutover runs the same code path as the nightly backups. Retention is inert
because each snapshot writes into its own `cutover-<timestamp>` directory.

Dry run verifies: `BACKUP_DIR` writable, Docker reachable, both containers
resolve, and `freeBytes` ≥ `requiredBytes` (1.5× total live Postgres bytes — a
deliberately conservative bound, since a gzipped dump is far smaller than the
live data).

`--execute` produces four artifacts plus `manifest.json`:

| Artifact | Source |
|----------|--------|
| `postgres/postgres_<ts>.sql.gz` | `pg_dumpall` streamed through the socket proxy |
| `mongodb/mongodb_<ts>.archive.gz` | `mongodump --archive --gzip` |
| `redis-users.acl` | the ACL file read from the redis container |
| `drizzle-state.tar.gz` | `packages/cloud-core/drizzle` |

Each is verified after writing — size floor, gzip integrity, SHA-256 recorded in
the manifest. An unverified dump is worse than no dump: it produces false
confidence at exactly the moment rollback matters. The ACL file is legitimately
tiny, so it only has to be non-empty; the dumps carry the 512-byte floor.

**Copy the snapshot off-device over Tailscale before proceeding.**

---

## `migrate-verify.ts`

The ALL-GREEN-or-abort gate.

```bash
bun run --cwd apps/api cutover:verify
bun run --cwd apps/api cutover:verify --live    # adds the production healthz probe
```

Read-only: no write transaction, no `--execute` path. Every check runs even
after an earlier one fails — during a window you need the whole picture in one
pass, not a bisect. Exits non-zero listing the failed check names.

| Check | Proves | Invariant |
|-------|--------|-----------|
| `users-migrated` | every legacy user has a Better Auth row | 5 |
| `passwords-carried` | password hashes byte-identical | 5 |
| `totp-unenrolled` | zero enrollments, no legacy secrets imported | 5 |
| `sample-password-verifies` | a real password still authenticates | 5 |
| `legacy-s3-credential` | NULL-project row exists and decrypts | 4 |
| `project-surface` | projects, API keys, S3 credentials survived | 1 |
| `resume-tokens` | sync resumes rather than full-resyncs | 2 |
| `meili-keys` | every issued key still validates in Meilisearch | 2 |
| `files-on-disk` | 12 sampled files present, checksums match | 3 |
| `share-token` | a pre-cutover share link still verifies | 3 |
| `seeded-tasks` | rollup enabled, `tiering_pass` **disabled** | — |

Checks needing operator input report **SKIP**, never a silent pass. Supply
`VERIFY_SAMPLE_USERNAME`/`VERIFY_SAMPLE_PASSWORD` and a `VERIFY_SHARE_TOKEN`
issued **before the freeze** to turn those two green.

`resume-tokens` only flags collections that have synced before and lost their
token; a never-synced collection legitimately has none.

---

## Rehearsal

Run the full sequence against the `cloud-staging` compose project on the Pi
(`infra/scripts/staging-up.sh`) with a restored copy of production dumps, before
scheduling the window:

1. restore dumps into staging
2. `cutover:snapshot --execute`
3. `cutover:apply-migrations --execute`
4. `auth:migrate-users --execute`
5. `cutover:migrate-s3-legacy --execute`
6. `cutover:verify` → must be all green
7. boot the full new stack; run `s3-smoke.ts`, `tus-smoke.ts`, and manual logins
8. record every step's timing in `infra/cutover/rehearsal-<date>.md`

The window estimate comes from those timings. Never patch staging by hand and
call it green — fix the upstream cause and re-run.

Two paths worth exercising specifically during rehearsal, because nothing local
covers them:

- the **"Cloud unreachable"** degraded state, while the Pi is actually restarting
- storage's file browser **above 300 rows**, where it switches to a windowed
  list (scrolling, keyboard nav, drag-and-drop)

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Missing required environment variable: SSD_STORAGE_PATH` from an S3 script | `storageConfigFromEnv()` validates the whole storage config | set `SSD_STORAGE_PATH`, `HDD_STORAGE_PATH`, `JWT_SECRET` |
| `Out of order: cloud-migration:012-schema has not completed` | ordering guard | run `cutover:apply-migrations --execute` first |
| `alreadyComplete: true` unexpectedly | marker already present | expected on re-run; check the marker's `created_at` |
| `Legacy access key … is already assigned to a project` | the access key was issued to a project | reconcile before boot — the API will refuse to start |
| `ciphertext does not decrypt under …` | row encrypted under a previous key | restore the correct `S3_CREDENTIAL_ENCRYPTION_KEY` |
| `Insufficient space in …` | `BACKUP_DIR` too small | free space or repoint `BACKUP_DIR`; do not override |
| `Docker is unreachable` | script runs on the host, not in the api container | set `DOCKER_HOST` to the socket or proxy address |
| `Snapshot artifact … is only N bytes` | dump failed mid-write | investigate the container; do not proceed |
| `migrate-verify` SKIPs several checks | optional env not supplied | set the `VERIFY_*` variables |
| `tiering_pass is ENABLED` | task seeded enabled | disable it; it stays off through cutover and the 48h soak |

---

## Out of scope

Deliberately **not** cutover blockers:

- migrating dependents off the shared legacy keypair onto per-project S3
  credentials, then retiring the NULL-project row
- enabling `tiering_pass` (operator enables after the 48h soak, having reviewed
  a `--dry-run` report in the admin UI — its first real pass moves data between
  disks)
- strict-TLS enforcement on the exposed DB ports
- old in-flight TUS uploads, which are not resumed across the cutover
