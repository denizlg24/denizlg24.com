# Cutover runbook — deniz-cloud → denizlg24.com monorepo

Big-bang cutover. Old stack runs until the freeze; data stays in place and
containers are swapped. Execute top to bottom. Every step has an expected
result and an abort criterion — if a step's expected result does not appear,
**stop and abort**; do not improvise.

See `MIGRATION-GUIDE.md` for what each script does, its full env requirements,
failure modes and troubleshooting. This file is the ordered checklist only.

> **Rehearsal gate**: do not schedule this window until a full rehearsal has
> completed GREEN end-to-end against the `cloud-staging` compose project on the
> Pi, with timings recorded in `infra/cutover/rehearsal-<date>.md`.

---

## 0. Conventions

All commands run from the repo root on the Pi unless stated otherwise.
Every script defaults to a **dry run**; `--execute` must be typed deliberately,
and passing both `--dry-run` and `--execute` is an error rather than a silent
precedence rule.

```bash
export CUTOVER_LOG=/srv/deniz-cloud/cutover/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$CUTOVER_LOG"
```

Append `--log "$CUTOVER_LOG/<step>.jsonl"` to every script call. Each script
prints one machine-readable JSON summary line on stdout and structured JSONL to
the log file.

**Point of no return** is step 9 (re-enabling the scheduler and sync workers —
the first new-schema-only writes). Before it, rollback is: restart the old
compose project and revert the tunnel ingress, ≤10 minutes. After it, rollback
requires a snapshot restore — a disaster path, not a routine one.

---

## 1. Pre-window (T-24h, nothing is frozen)

Everything here is read-only and safe to run against the live old stack.

- [ ] **Regenerate the dependent change list.**
  ```bash
  bun run --cwd apps/api cutover:inventory --report infra/cutover/change-list.md
  ```
  Expected: JSON summary with a non-zero `projects` count, and
  `collectionsMissingResumeToken: 0`.
  Abort criterion: any project you do not recognise, or a non-zero
  `collectionsMissingResumeToken` (those collections would full-resync,
  breaking invariant 2).

- [ ] **Dry-run every mutating script.** None of these write anything.
  ```bash
  bun run --cwd apps/api cutover:apply-migrations
  bun run --cwd apps/api auth:migrate-users
  bun run --cwd apps/api cutover:migrate-s3-legacy
  bun run --cwd apps/api cutover:snapshot
  ```
  Expected: `apply-migrations` lists the pending tags; `migrate-users` reports
  the user counts; `migrate-s3-legacy` reports `would-create` or `would-reuse`;
  `snapshot` reports `freeBytes` > `requiredBytes`.
  Abort criterion: `migrate-s3-legacy` reporting a collision or a decrypt
  failure — fix it now, while the old stack is still serving and rollback is
  free. This is the whole reason the preflight exists.

- [ ] **Confirm secrets carried over into the Pi `.env`.** These must be the
  *old* production values, byte for byte:
  - `JWT_SECRET` — share-link HMACs (invariant 3)
  - `DATABASE_CREDENTIAL_ENCRYPTION_KEY` — must equal the old
    `TOTP_ENCRYPTION_KEY`, or every provisioned project DB password becomes
    undecryptable
  - `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — the legacy keypair every
    dependent signs with today
  - `S3_CREDENTIAL_ENCRYPTION_KEY`

- [ ] **Notify dependent projects** using `infra/cutover/change-list.md`. The
  only required change is the S3 endpoint:
  `https://storage.denizlg24.com/v2` → `https://api.denizlg24.com/v2`.
  Credentials, DB hosts and ports are unchanged.

---

## 2. Freeze

- [ ] Announce the window.
- [ ] Stop the old admin and storage containers. **Databases stay up.**
- [ ] Disable the old scheduler crons.

Expected: old admin/storage endpoints stop answering; `psql`/`mongosh`/
`redis-cli` against the public ports still connect.
Abort criterion: databases became unreachable — restart the old stack, stand down.

---

## 3. Snapshot (the rollback asset)

- [ ] ```bash
  bun run --cwd apps/api cutover:snapshot --execute --log "$CUTOVER_LOG/snapshot.jsonl"
  ```

Expected: a `cutover-<timestamp>` directory containing `manifest.json` and four
verified artifacts (postgres dump, mongo archive, redis ACL, drizzle state),
each with a SHA-256 and a passing gzip integrity check.
Abort criterion: any artifact fails verification, or the script reports
insufficient free space. **Do not proceed without a verified snapshot** — this
is the only thing standing between a bad migration and permanent data loss.

- [ ] Copy the snapshot off-device over Tailscale before continuing.

---

## 4. Schema

**Baseline first.** Production's schema was built by the old system, so drizzle
has no record of it. `0000_serious_spiral` describes tables that already exist —
executing it collides on `CREATE TYPE`. Record it as applied instead:

- [ ] ```bash
  bun run --cwd apps/api cutover:apply-migrations --baseline 0000_serious_spiral
  bun run --cwd apps/api cutover:apply-migrations --baseline 0000_serious_spiral --execute
  ```
  Expected: `baseline: ["0000_serious_spiral"]`. Skip only if the dry run
  reports `alreadyRecorded: true`.

- [ ] ```bash
  bun run --cwd apps/api cutover:apply-migrations --execute --log "$CUTOVER_LOG/migrations.jsonl"
  ```

Expected: `applied` lists `0001`–`0004`, and the script re-reads the journal to
confirm nothing is still pending.
Abort criterion: any migration error → restore from snapshot, restart old stack.

> `0004` adds the `run_command` value to the `task_type` enum. Without it every
> `run_command` task insert fails, so this must land before the new API boots.

---

## 5. Users

- [ ] ```bash
  bun run --cwd apps/api auth:migrate-users --execute \
    --report "$CUTOVER_LOG/users-report.json" --log "$CUTOVER_LOG/users.jsonl"
  ```

Expected: summary with `usersRequiringTotpEnrollment` equal to `totalUsers`, and
an encrypted report written (needs `AUTH_MIGRATION_REPORT_KEY`, ≥32 chars).
Abort criterion: any error → restore from snapshot. Legacy TOTP and recovery
rows are left untouched, so rollback is still clean at this point.

> Users must be migrated **before the new API's first boot**: ops task seeding
> runs only at API start and no-ops when no superuser row exists (008 drift).

- [ ] ```bash
  bun run --cwd apps/api cutover:migrate-s3-legacy --execute --log "$CUTOVER_LOG/s3.jsonl"
  ```
  Expected: `outcome` of `created` or `already-correct`.

---

## 6. Verify — ALL GREEN or abort

- [ ] ```bash
  bun run --cwd apps/api cutover:verify --log "$CUTOVER_LOG/verify.jsonl"
  ```

Supply the operator-only inputs first, or those checks report SKIP:

```bash
export VERIFY_SAMPLE_USERNAME=... VERIFY_SAMPLE_PASSWORD=...
export VERIFY_SHARE_TOKEN=...   # a share token issued BEFORE the freeze
```

Expected: `green: true`, and an empty or understood `skipped` list. The checks:

| Check | Proves |
|-------|--------|
| `users-migrated` | every legacy user has a Better Auth row |
| `passwords-carried` | password hashes byte-identical (invariant 5) |
| `totp-unenrolled` | zero enrollments, no legacy secrets imported |
| `sample-password-verifies` | a real password still authenticates |
| `legacy-s3-credential` | the NULL-project row exists and decrypts (invariant 4) |
| `project-surface` | projects, API keys and S3 credentials survived |
| `resume-tokens` | sync resumes rather than full-resyncs (invariant 2) |
| `meili-keys` | every issued Meilisearch key still validates (invariant 2) |
| `files-on-disk` | sampled files present with matching checksums (invariant 3) |
| `share-token` | a pre-cutover share link still verifies (invariant 3) |
| `seeded-tasks` | rollup enabled, `tiering_pass` **disabled** |

Abort criterion: **any** FAIL. Restore from snapshot and restart the old stack.

---

## 7. Bring up the new stack

- [ ] `docker compose -f infra/compose/docker-compose.pi.yml up -d` (same volumes)
- [ ] Install and enable the host units (terminal, reboot path):
      `infra/scripts/install-host-units.sh`
- [ ] Cloudflared ingress: point `api.denizlg24.com` → the api container port;
      remove the old storage/cloud/search ingress rules.

Expected: `/healthz` answers with the new version; containers stay within the
memory budget in `infra/README.md`.
Abort criterion: crash loop → `docker compose down`, revert ingress, restart the
old stack. Still before the point of no return.

- [ ] Attach the `cloud.` and `storage.` domains to their Vercel projects and
      confirm propagation.

---

## 8. Verify live

- [ ] ```bash
  bun run --cwd apps/api cutover:verify --live --log "$CUTOVER_LOG/verify-live.jsonl"
  ```
- [ ] Run the storage smokes against the production endpoint:
      `s3-smoke.ts`, `tus-smoke.ts`.
- [ ] Check one dependent project end-to-end after it flips its `S3_ENDPOINT`.

Abort criterion: any smoke failure → revert ingress and restart the old stack.

---

## 9. Point of no return

- [ ] Re-enable the scheduler and sync workers.

From here rollback means a snapshot restore. Everything above this line was
reversible in minutes.

- [ ] Confirm `tiering_pass` is still **disabled**. It stays off through the
      48h soak; the operator enables it only after reviewing a `--dry-run`
      report in the admin UI. Its first real pass moves data between disks.

---

## 10. Post-cutover

- [ ] Walk `infra/cutover/change-list.md` and tick off each dependent project as
      its envs are updated.
- [ ] Every human user: sign in, re-scan a Better Auth TOTP QR code, verify it,
      and **retain the newly generated backup codes**. Legacy TOTP secrets and
      recovery codes were deliberately not imported. No recovery codes are
      distributed from the migration report.
- [ ] Begin the 48h soak: dashboard watch, old repo left untouched on disk.
- [ ] Exercise the "Cloud unreachable" degraded state while the Pi restarts —
      it is the one path local testing never covers (010 note).

Deferred to post-cutover, explicitly **not** blockers:
- migrating dependents off the shared legacy keypair onto per-project S3
  credentials, then retiring the NULL-project row
- enabling `tiering_pass`
- strict-TLS enforcement on the exposed DB ports

---

## Rollback procedures

**Before step 9** — restart the old compose project, revert the cloudflared
ingress to the old storage/cloud/search rules. ≤10 minutes. The new schema
additions are additive and harmless to the old code.

**After step 9** — disaster path:
1. Stop the new stack.
2. Restore Postgres from `manifest.json`'s postgres artifact (verify its SHA-256
   first), then MongoDB from the archive, then the Redis ACL file.
3. Restart the old compose project and revert ingress.
4. Expect to lose writes made after the point of no return.
