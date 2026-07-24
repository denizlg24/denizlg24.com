# Cloud 013: Decommission & documentation

> **Executor instructions**: Only start after plan 012's cutover has soaked
> 48h+ in production with the operator's explicit go-ahead. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: opus 4.8
- **Effort**: S
- **Risk**: LOW (but irreversible steps gated on operator confirmation)
- **Depends on**: 012 verified in production
- **Category**: cleanup / docs

## Scope

1. **Old stack retirement** (operator runs; you author exact commands):
   remove old repo's containers/images from the Pi; the old repo directory
   on the Pi is archived (`tar` → BACKUP_DIR + one copy pulled off-device
   via tailscale) then deleted; retire dead DNS records (old tunnel
   ingress already removed in 012); GitHub: archive the `deniz-cloud`
   repository (read-only), update its README pointing here.
2. **Submodule removal**: `git submodule deinit -f vendor/deniz-cloud`,
   `git rm vendor/deniz-cloud`, remove from `.gitmodules`, drop
   `vendor/README.md`. Grep the repo for any lingering
   `vendor/deniz-cloud` references in code/docs (plan files keep their
   references — they're historical record; everything else must not).
3. **Documentation**:
   - Update root `CLAUDE.md`: new apps/packages (`apps/api`, `apps/cloud`,
     `apps/storage`, `apps/terminal`, `packages/cloud-core`,
     `packages/cloud-ui`, schemas `cloud/` subpath), infra layout
     (`infra/`), deploy flow, Tailscale access, cutover date.
   - `infra/README.md` finalized: topology diagram (text), runbooks index
     (deploy, rollback, backup-restore, break-glass access), memory
     budget table for the Pi.
   - Regenerate/write OpenAPI for `apps/api` if 004 deferred it; place
     under `apps/api/docs/`.
   - `plans/cloud/README.md`: mark program COMPLETE with dates; append a
     retrospective note (what drifted, for future programs).
   - `plans/README.md` (root): add a closing status line for the cloud
     program row added at kickoff.
4. **Dependent-project confirmations**: checklist from 012's change list —
   operator confirms each project migrated its envs; chase stragglers
   before old DNS records die.
5. **Loose ends sweep**: grep for TODO/Drift-log items across
   `plans/cloud/*` and file them as issues (or a `plans/cloud/FOLLOWUPS.md`)
   — e.g. S3 multipart (004), desktop-app cloud panels (008 future note),
   folder upload (009), meilisearch version bumps.

## Verification

```
bunx turbo build && bunx turbo typecheck && bunx turbo test
bun run format-and-lint
git grep -n "vendor/deniz-cloud" -- ':!plans'   # → no hits
# operator confirms: old containers gone, archive copy exists off-device,
# GitHub repo archived.
```

## STOP conditions

Runbook STOPs, plus: ANY deletion step without the operator's explicit
confirmation in-session; production alarm during the session (abort, this
plan can always wait).

## Drift log

- **From 004 (2026-07-23):** OpenAPI regeneration was deferred. Generate the
  consolidated `/api/storage/*`, `/api/search`, and `/v2` documents from the
  current Hono routes and `packages/schemas/src/cloud/storage.ts`; do not copy
  the legacy route prefixes back into the published contract.
