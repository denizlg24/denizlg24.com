# Cloud 012: Migration scripts, rehearsal, and the big-bang cutover runbook

> **Executor instructions**: This plan has two halves. Half A (scripts +
> rehearsal) is a normal agent session. Half B (the runbook) is executed BY
> THE OPERATOR on the Pi during the cutover window, with an agent session
> assisting. Nothing in Half A touches production. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6 (Half A); operator + agent (Half B)
- **Effort**: L (scripts) + cutover window (~half a day incl. soak)
- **Risk**: HIGHEST of the program — live dependents
- **Depends on**: 002–011 all DONE
- **Category**: migration

## Invariants (what "success" means)

1. Dependent projects' Postgres/Mongo/Redis connections work unchanged
   (same hosts/ports/credentials/data).
2. Meilisearch tenant tokens and per-project keys keep validating; sync
   resumes from stored resume tokens (no full resync).
3. All files remain served; share links issued before cutover still open.
4. S3 consumers work after a one-line endpoint change
   (`S3_ENDPOINT=https://api.denizlg24.com/v2`) with unchanged credentials:
   the single legacy env keypair is migrated into the new `s3_credentials`
   table as the NULL-project full-access row (004) and must validate
   identically. Migrating consumers onto per-project credentials (and
   retiring the legacy row) is a post-cutover task on the change list, not
   a cutover blocker.
5. Human users re-login (sessions dropped by design); passwords and TOTP
   enrollments carry over; recovery codes are REISSUED (003) and delivered
   to users from the migration report.
6. Rollback to the old stack possible within minutes at any point before
   the "point of no return" (defined below as: first new-schema-only write).

## Half A — scripts + rehearsal (agent session)

1. **Migration scripts** in `apps/api/scripts/` (all idempotent, `--dry-run`
   default, `--execute` flag, structured log to file):
   - `migrate-users.ts` (exists from 003 — extend for full-fidelity run,
     produce the recovery-codes report).
   - `migrate-s3-legacy.ts` — reads the old env keypair, inserts the
     NULL-project `s3_credentials` row (encrypting the secret per 004);
     refuses to run twice.
   - `migrate-verify.ts` — post-migration assertions: row counts per table
     old-vs-new views, sample user can auth (password verify against
     migrated hash), every project's meili key validates, one provisioned
     credential per db_type connects, N random files stat OK on disk +
     checksum spot-check, share-link HMAC verifies a pre-cutover token
     (operator supplies one), resume-token rows present.
   - `pre-cutover-snapshot.ts` — pg_dump of cloud DB, mongo dump of
     internal collections, redis ACL file copy, tarball of drizzle state →
     timestamped dir under BACKUP_DIR (this is the rollback asset).
   - New-schema migrations application step (`drizzle-kit migrate` for the
     003 better-auth tables + 006 metrics tables + any 002 additive ones).
2. **Cutover checklist generator**: `infra/cutover/RUNBOOK.md` — author it
   fully (Half B below is its outline; expand each step with exact commands,
   expected output, abort criteria, and a checkbox). Include the
   **dependent-projects change list**: enumerate every consumer the operator
   names (agent: ask the operator for the list during this session — at
   minimum apps/web `resources`/S3/`MONGO_RESOURCE_URI` usage in THIS repo:
   grep it and list concrete env keys per project) with old→new values
   (S3 endpoint; anything else discovered).
3. **Rehearsal** (the actual verification of Half A): using 011's staging
   compose project + a SANITIZED copy of production data (operator provides
   dumps via tailscale scp; sanitize = fine to keep as-is, it's the
   operator's own data — just never push it): restore dumps into staging →
   run snapshot → migrations → verify script → boot full new stack → run
   004's s3-smoke + tus-smoke + 008/009 manual logins against staging →
   record timings of every step in the runbook (the cutover window estimate
   comes from this). Rehearsal must complete GREEN end-to-end before Half B
   is scheduled.

## Half B — cutover runbook outline (operator + agent, on the Pi)

1. Freeze: announce window; stop old admin/storage containers (DBs stay up);
   disable old scheduler crons.
2. `pre-cutover-snapshot.ts --execute`.
3. Apply new drizzle migrations; run `migrate-users.ts --execute`;
   `migrate-verify.ts` → ALL GREEN or abort (rollback: restart old
   containers — nothing destructive has happened).
4. Stop remaining old containers; `docker compose -f docker-compose.pi.yml
   up -d` (same volumes); install/enable host units (terminal, reboot-path);
   cloudflared ingress switch: `api.denizlg24.com` → api; remove old
   storage/cloud/search ingress.
5. DNS/Vercel: attach `cloud.` + `storage.` domains to Vercel projects
   (011 prepared); confirm propagation.
6. Verify invariants 1–5 live (scripted where possible: `migrate-verify.ts
   --live` mode + s3-smoke against production endpoint + one dependent
   project checked end-to-end).
7. **Point of no return**: re-enable scheduler + sync workers (first
   new-only writes). Before this line, rollback = restart old compose +
   revert ingress (≤10 min). After: rollback requires the snapshot restore
   (documented, but treat as disaster path). The NEW `tiering_pass` task
   stays DISABLED through cutover and soak — the operator enables it only
   after the 48h soak, and only after reviewing a `--dry-run` report in the
   admin UI (first real pass moves data between disks; do it eyes-open, not
   during the cutover window).
8. Update dependent projects' envs (change list), operator distributes new
   recovery codes, 48h soak with dashboard watch + old repo left untouched
   on disk.

## Verification (Half A session)

```
bunx turbo typecheck --filter=api && bunx turbo test --filter=api
bun run format-and-lint
# rehearsal log committed to infra/cutover/rehearsal-<date>.md with timings
# and every verify assertion green
```

## STOP conditions

Runbook STOPs, plus: rehearsal any-step failure (fix upstream plan, re-run;
never patch staging by hand and call it green); missing operator input
(dependent-project list, production dumps); anyone attempting Half B before
rehearsal is green.

## Drift log

(record deviations here)
