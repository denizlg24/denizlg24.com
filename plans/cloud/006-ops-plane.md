# Cloud 006: Ops plane — scheduler, executors, metrics, health

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6
- **Effort**: L
- **Risk**: MED (docker.sock power; host visibility from a container)
- **Depends on**: 003
- **Category**: backend / observability

## Why

The admin panel's operational core: scheduled tasks (DB/file backups,
container restarts, reboot), system stats, and — per locked decision 6 — a
richer, Prometheus-free observability layer: metrics history in Postgres,
rendered by `apps/cloud` (008), integrated with `apps/web`'s resources
health system.

## Source material (`vendor/deniz-cloud/packages/admin-api/src`)

- `scheduler.ts` (croner; cron + one-off polling every 30s; interrupted-run
  marking; `scheduled_tasks`/`task_runs` tables), `executors/{backup-files,
  backup-mongodb,backup-postgres,restart-container,reboot-server,utils}.ts`
- `routes/{stats,tasks}.ts` — stats via `/host/proc`, `/host/sys`,
  `/host/rootfs` bind mounts with node:os fallback; BusyBox-compatible df
  parsing; storage stats (counts/sizes/tiers).
- Compose: admin container mounts `/var/run/docker.sock`, `/proc:/host/proc:ro`,
  `/sys:/host/sys:ro`, `/:/host/rootfs:ro`; env `SSD_DEVICE`, `HDD_DEVICES`,
  `MICROSD_DEVICE`, `BACKUP_DIR`.
- Old-repo commit context: task status display fixes, backup dirs.

## Security hardening (improvements over old design)

1. **No raw docker.sock in `apps/api`**: front it with
   `tecnativa/docker-socket-proxy` (tiny; allow only the endpoints executors
   need: containers list/inspect/restart/stats). Compose wiring lands in 011;
   here code against `DOCKER_HOST=tcp://docker-proxy:2375` with the client
   confined to a `cloud-core/docker.ts` module. Reboot executor: instead of
   privileged access, write a sentinel file to a host-mounted path consumed
   by a host-side systemd path unit (unit file authored in 011) — document
   the contract in `infra/README.md`.
2. All ops routes superuser-only (003 middleware) + audit log: every executor
   run and manual trigger writes a `task_runs` row (existing table covers it;
   extend fields only via new migration if needed).

## Scope

1. Port scheduler + executors into `apps/api` (start/stop with the server,
   same tables). Executors get typed configs (zod in schemas/cloud) and
   structured run logs (stdout tail persisted on the run row, as old code).
   **Extend `task_type` enum (new migration)** with `tiering_pass` (executor
   = 004's `runTieringPass()`; register a default nightly schedule seeded as
   a disabled task the operator enables post-cutover — the old system NEVER
   had a tiering cron, this is a new capability) and `metrics_rollup` (item
   2's rollup).
   Backups: postgres (pg_dump via container exec through the proxy — or the
   old approach if it shells pg_dump; match old artifact format/paths under
   `BACKUP_DIR`), mongodb (mongodump), files (tar of metadata-selected
   paths). Retention pruning setting per task.
2. Port stats collection; then extend into a **metrics sampler**: every 30s
   sample host CPU/mem/load/temp (`/host/sys/class/thermal`), per-disk usage
   (SSD/HDD/microSD devices from env), network rx/tx per interface
   (`/host/proc/net/dev` deltas), per-container CPU/mem/net via docker stats
   through the proxy. Persist to new `metrics_samples` (narrow rows:
   ts, kind, key, value) with a pruning task (raw ≥ 24h @30s, rollup to
   5-min rows kept 90d — implement rollup as a scheduled task). New tables =
   new Drizzle migration in `cloud-core` (applied in 012; dev applies
   immediately).
3. Endpoints for 008: `GET /api/ops/overview` (current snapshot),
   `GET /api/ops/metrics?series=...&from=...&to=...&step=...` (downsampled
   series), `GET /api/ops/tasks` CRUD + run history + manual trigger,
   `GET /api/ops/containers` (list + state + restart action). Zod contracts
   in `packages/schemas/src/cloud/ops.ts`.
4. **Health/heartbeat for apps/web resources integration**: public
   `GET /healthz` (001) plus authenticated `GET /api/ops/health` returning
   per-service checks (pg, mongo, mongot, redis, meili, disk headroom,
   tunnel). `apps/web`'s resource sub-resource checks (`http` type,
   `expectJsonPath`) can then point at it — do NOT modify apps/web here;
   record the recommended check configs in `infra/README.md` for the
   operator.
5. Alert evaluation as a scheduled task type: thresholds (disk %, temp, mem,
   service down) → notification via webhook URL env (reuse the pattern from
   old repo if present; else simple POST). Config via task payload zod.
   **Plus task-failure notifications (NEW — old PLAN.md "email/notification
   on backup failure" was never built)**: any `task_runs` row ending
   `failed` (backups especially) fires the same notification channel with
   task name, error tail, and run link; throttle repeats (max 1 per
   task per 6h).
6. Tests: scheduler (fake timers; overlap suppression via `activeRuns`),
   executors against dev infra (backup postgres/mongo produce restorable
   artifacts — restore-verify in the test), sampler parsing fixtures for
   `/proc` formats (commit fixture files), metrics rollup correctness.

## Verification

```
bunx turbo typecheck --filter=api --filter=@repo/cloud-core
bunx turbo test --filter=api --filter=@repo/cloud-core
bun run format-and-lint
# manual: dev api + dev infra → create a one-off backup task via curl,
# confirm task_runs row + artifact; GET /api/ops/metrics returns series.
```

## STOP conditions

Runbook STOPs, plus: an executor genuinely requires privileges the
socket-proxy can't grant (report the minimal additional allow, don't mount
raw sock); metrics sampling measurably starves the Pi RAM budget in local
profiling (>50MB steady-state for the sampler → simplify cadence, report).

## Drift log

- **From 004 (2026-07-23):** `runTieringPass`,
  `createTieringRepository`, `PromotionQueue`, and `tieringReportSchema` are
  exported from cloud-core. Register `tiering_pass` here, pass the storage
  paths/watermark/age/size/batch config, expose dry-run reports for 008, and
  keep the first real schedule disabled until 012's post-cutover soak.
- **Implementation (2026-07-24):** Added migration
  `0003_daffy_doctor_doom.sql`, the narrow raw/rollup metrics store, typed
  scheduler/executors, failure-notification throttling, superuser ops routes,
  authenticated component health, and a loopback-only dev socket proxy.
  Database backups stream Docker exec output directly to disk and were
  restored into isolated PostgreSQL and MongoDB containers. A full curl smoke
  created and ran an audited one-off PostgreSQL backup and queried live metrics.
  The sampler stayed 32.1 MiB above baseline across ten cycles, below the 50 MiB
  STOP threshold.
- **Deviations (2026-07-24):** A Mongo archive can target the full cluster or
  one database because the installed `mongodump` does not support multiple
  namespace filters in one archive. File backups are tar/tar.gz artifacts under
  `BACKUP_DIR/files`. The existing apps/web health-check model cannot attach a
  secret header or session cookie, so `/healthz` plus TCP checks remain public;
  private component checks must use a future authenticated relay.
