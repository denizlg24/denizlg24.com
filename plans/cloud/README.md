# Cloud rewrite program — status

Entry point: `000-execution-runbook.md`. One plan per fresh session. Update
your plan's row when done (date + deviations). Executor = model that runs it.

| Plan | Title | Executor | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Workspace foundation (submodule, scaffolds, turbo, CI skeleton) | opus 4.8 | M | — | DONE 2026-07-23 (see Drift log in 001; deviations: Next apps use standalone create-next-app tsconfig like apps/web; `cloud:dev:infra` uses `--env-file`; mongo dev keyfile generated in-container + named volumes; biome `!vendor`; turbo build outputs +`dist/**`; cloud/storage have no `test` script yet) |
| 002 | Cloud core port (`@repo/cloud-core`: schema, services, middleware) | gpt5.6 | L | 001 | DONE 2026-07-23 (exact Drizzle parity against historical pre-0001 schema + old 0001–0007; baseline committed; deviations: old fresh-install SQL already contained 0001–0003, so audit reconstructed `8e7862c^`; raw-SQL constraint names modeled explicitly; `meilisearch` SDK 0.60 client-class rename hidden behind legacy `MeiliSearch` alias; password/TOTP/JWT/session resolution remains in 003 as planned) |
| 003 | Auth: better-auth + API keys + cross-subdomain sessions | gpt5.6 | L | 002 | DONE 2026-07-23 (Better Auth 1.6.25 + generated five-table forward migration; legacy Argon2id hashes preserved; pending signup, mandatory MFA enrollment, cross-subdomain sessions/CORS, Redis login limits, unified session/API-key middleware, and `@repo/cloud-auth-client` delivered. Deviations: operator chose mandatory TOTP re-enrollment because legacy OTPAuth secrets are incompatible with standard Better Auth behavior; no TOTP shim/secret import, legacy recovery codes invalidated, new backup codes issued at enrollment; client helper isolated from schemas. See 003/012 Drift logs.) |
| 004 | Storage engine (files, TUS, S3 `/v2`, shares, tiering) | gpt5.6 | XL | 003 | DONE 2026-07-23 (files/folders/search/share/Range, resumable TUS, store-only ZIP, legacy-compatible S3 including multipart, per-project encrypted credentials, atomic tiering/promotion, migration 0002, and live AWS SDK/TUS smokes delivered. Deviations: project S3 prefix maps to its exact slug bucket; legacy env credential migrates idempotently at startup; ZIP32 caps configurable archives below 4 GiB; OpenAPI regeneration deferred to 013. See 004 and affected-plan Drift logs.) |
| 005 | Projects platform (provisioning PG/Mongo/Redis, search sync) | gpt5.6 | XL | 003 (004 for storage folders) | DONE 2026-07-24 (project/API-key/S3 lifecycle, reveal-once PG/Mongo/Redis provisioning, persistent Redis ACLs, Mongo + PG-outbox sync, collections/tokens, mongot vectors, and guarded DB admin delivered. Deviations: infra-backed suites are opt-in via `RUN_CLOUD_INFRA_TESTS=1`; Mongo worker and admin use separate least-privilege clients; Meili mutations await task completion before persisted cursors advance.) |
| 006 | Ops plane (scheduler, executors, metrics, health) | gpt5.6 | L | 003 | DONE 2026-07-24 (typed scheduler/executors, audited manual runs, proxy-streamed PostgreSQL/Mongo backups with restore verification, file backups, tiering/restart/reboot/rollup/alert tasks, 30s host/container/storage metrics, 5m/90d rollups, superuser ops APIs, component health, migration 0003, and a PowerShell HTTP smoke harness delivered. Sampler profiling peaked 32.1 MiB above baseline. Deviations: Mongo filters support zero or one database per archive; authenticated component health requires a future apps/web secret-header relay. See 006/008/011/012 Drift logs.) |
| 007 | Terminal service rewrite (hardened, tmux-persistent) | gpt5.6 | M | 006 | DONE 2026-07-24 (loopback-only unprivileged Bun service, persistent tmux attach/list/kill/reap, 30s single-use HMAC tickets with API+service double verification, heartbeat and two-hop backpressure, systemd hardening, Linux real-tmux tests, and 10 MB smoke harness delivered. Deviation: selected `bun-pty` after the pinned Linux Bun runtime failed the built-in PTY spike; its packaged ARM64 Rust library keeps the artifact free of Node addons. See 007/008/011 Drift logs.) |
| 008 | `apps/cloud` admin app (dashboard, users, projects, DBs, tasks, terminal, observability) | fable 5 | XL | 003, 006 (007 for terminal tab) | DONE 2026-07-24 (all eight screens delivered in the monorepo editorial style: login with TOTP/recovery/forced-enrollment, flagship observability dashboard with validated chart palette and 24h/7d/90d series, users, projects drill-down incl. per-project S3 credentials and legacy shared row, pg/mongo database inspection with query consoles plus adminer/mongo-express iframed through a new superuser `/api/ops/tools/*` proxy, typed task forms with croner next-run preview and tiering dry-run report, xterm terminal over 007 tickets, settings. Backend additions in the same slice: `GET /api/auth/admin/users`, `POST /api/auth/admin/reset-mfa` (resetUserMfa now also clears Better Auth twoFactor + sessions), `GET /api/storage/s3-credentials`, ops tools proxy, `/healthz` CORS, dev-compose adminer/mongo-express. Deviations: metrics `series` query is one comma-separated param; task-seeding needs an existing superuser at API start; storage folder links assume 009 serves `/folders/:id`. See 008/009/010/011 Drift logs.) |
| 009 | `apps/storage` file browser app (browse, upload, preview, share, search) | fable 5 | XL | 003, 004 | DONE 2026-07-24 (Next.js on :3005: login with TOTP/recovery/signup-code redemption, mandatory `/setup-mfa` enrollment, `/folders/:id` browser with sidebar tree, breadcrumbs, grid/list + density, multi-select, full keyboard nav, drag-drop move, inline rename/create, undo-toast delete, TUS uploads incl. folder uploads with a persistent dock, previews (image zoom, video/audio Range, PDF, markdown, highlighted code, text), share popover with expiry presets, public `/s/:token` page, `?` search palette + `/search`, and account password/TOTP/backup-code management. Backend additions: `ancestors` on folder contents, `DELETE /folders/:id?recursive=true`, `GET /share/:token/meta`, `updateFolderInputSchema` with `parentId`. Fixed two read-then-write races in `createFolder`/upload finalize whose rollback deleted the race winner's data. Deviations: local folder cache instead of TanStack Query (not a repo dep), blob-iframe PDF preview instead of react-pdf, buffered ZIP download for progress. See 009 Drift log.) |
| 010 | UI consolidation & polish (shared components → `@repo/ui`, responsive, a11y) | opus 4.8 | M | 008, 009 | DONE 2026-07-25 (new `@repo/cloud-ui` holds the auth shell/forms, TOTP enrollment + backup codes, `ApiError`/`errorMessage`, formatters, `usePoll`, status-tone mappers and the `Unreachable`/`UnreachableBanner` degraded states; six primitives promoted to `@repo/ui` — `CopyButton`+`useCopy`, `SecretValue`, `Section`, `StatusDot`, `ConfirmButton`, `TypedConfirmDialog`. Four hand-rolled clipboard implementations and three TOTP enrollment flows collapsed to one each. Worst first-load JS: cloud 383.5→300.1 kB gzip, storage 601.3→340.6 kB; no route regressed. Deviations: plan 001 never recorded a bundle baseline so 010's pre-change numbers are it; cloud/storage `AppShell`, `SessionProvider` and `auth-client.ts` stay app-local by design; **cloud and storage still differ on whether TOTP is disabled before re-enrollment — flagged, not reconciled**; storage large-folder windowing is threshold-gated at 300 rows and is unverified in a browser. Screenshot/manual pass at 375/768/1280 still outstanding. See 010 Drift log.) **Code-complete, NOT release-verified** — do not read this row as a cutover green light: the 5k-row windowing path (scroll, keyboard nav, drag-drop, range-select) has never run in a browser, the three-width screenshot pass has not happened, and the cloud/storage TOTP re-enrollment divergence is open. None blocks cutover (012 migrates every user unenrolled, so both apps take the same `enable()` path), but all three need a human before 010 counts as verified. |
| 011 | Infra & deploy (Tailscale, arm64 images, GHCR, compose, CI/CD) | gpt5.6 | L | 001 (finalize after 006) | IN PROGRESS 2026-07-23 (Tailscale off-LAN gate PASSED: macOS → `pi-cloud` at `100.89.155.9`, subnet `192.168.1.0/24`; preliminary ARM64 API image, production/staging compose, host units, GHCR deploy workflow, UFW/fail2ban/accept-both TLS, DDNS, and Vercel runbooks authored and locally verified. Plans 004–007 are endpoint-complete. Finalization remains gated on the Pi staging/load test + recorded memory peaks, wiring 007's ready terminal artifact into the release workflow, the first GHCR run, and operator application/verification of §5 network/TLS and §6 Vercel projects. Deviations: Redis AUTH failures require a 16 MiB ACL-log audit sidecar; optional Redis TLS uses new port 6381; admin tools are loopback-only under a compose profile.) |
| 012 | Migration scripts, rehearsal & cutover runbook | gpt5.6 + operator | L | 002–011 | IN PROGRESS 2026-07-25 — **Half A scripts + runbook written and green (typecheck/test/lint); rehearsal NOT run.** `apps/api/scripts/`: shared dry-run harness (`lib/runner.ts`), `inventory-dependents.ts` (new — generates the change list from the live DB), `apply-migrations.ts`, `migrate-s3-legacy.ts` (preflight over the existing startup path, not a reimplementation), `pre-cutover-snapshot.ts` (reuses 006's backup executors, verifies every artifact), `migrate-verify.ts` (11 checks, all-green-or-abort). `infra/cutover/RUNBOOK.md` authored. Fixed a marker-identifier mismatch that would have blocked the S3 preflight's ordering guard. Rehearsal is gated on 011's Pi staging bring-up. See 012 Drift log. |
| 013 | Decommission & docs (remove submodule, archive, dependent-project updates) | opus 4.8 | S | 012 in prod | TODO |

## Notes between sessions

- **2026-07-25 (010 done)** — UI is consolidated. For plans 012/013:
  - New workspace `packages/cloud-ui` (`@repo/cloud-ui`). Anything shared by
    both Vercel apps goes there; pure primitives go to `@repo/ui`. A consumer
    must add it to **both** `transpilePackages` and the `@source` globs in
    `globals.css`, or Tailwind drops its classes with no error.
  - Every screen degrades to a "Cloud unreachable" state instead of spinning
    when the API is down: `usePoll` now returns `unreachable`, and each app
    shell polls `/healthz` to raise a banner. Worth exercising during the 012
    rehearsal while the Pi is actually restarting — that is the one path no
    amount of local testing covers.
  - ~~**Open question for the operator**: `apps/cloud` settings re-enrolls TOTP
    without calling `twoFactor.disable()` first; `apps/storage` account settings
    does call it.~~ **RESOLVED 2026-07-25**: `apps/cloud` now calls
    `twoFactor.disable()` first, matching storage.
  - Storage's file browser windows its row list above 300 items. If 012's
    rehearsal touches a folder that large, verify scrolling, keyboard nav and
    drag-and-drop there specifically.

- **2026-07-24 (005 done)** — Projects platform is green. For plans
  006/008/011/012/013:
  - `/api/projects/*` now owns project, scoped API-key, collection/search,
    provisioned-database, vector-index, and S3-credential lifecycles.
    Project database and S3 secrets are returned only at create/rotate time;
    list responses contain metadata only.
  - Preserve the old production `TOTP_ENCRYPTION_KEY` exactly as
    `DATABASE_CREDENTIAL_ENCRYPTION_KEY` at cutover so existing encrypted
    project database passwords remain usable. Mongo sync uses
    `MONGODB_URI`; provisioning, vector, and admin routes use
    `MONGODB_ADMIN_URI`.
  - Redis project ACL users are reconciled from Postgres during API startup
    and persisted with `ACL SAVE`. The dev stack now uses the same ACL-file
    entrypoint contract as production.
  - Mongo resume tokens and Postgres outbox cursors advance only after the
    corresponding Meilisearch task completes. Plan 012 should run the
    opt-in infra suite during rehearsal.

- **2026-07-23 (004 done)** — Storage is green. For plans
  005/006/008/009/012/013:
  - Apply `0002_massive_kang.sql`. Storage logic and S3 credential helpers are
    exported from `@repo/cloud-core/storage`; canonical client contracts are
    in `@repo/schemas/cloud`. Continue using 003's unified auth middleware.
  - Project S3 credentials are restricted to the exact bucket named by the
    project slug. Plan 005 owns issuance/rotation/revocation endpoints and
    must invalidate the resolver after mutations. NULL-project credentials
    retain unrestricted legacy behavior.
  - `runTieringPass` and the promotion queue implement
    copy → checksum verify → metadata compare/swap → source delete. Plan 006
    owns the `tiering_pass` executor/schedule; plan 008 surfaces dry-run
    reports. Keep real tiering disabled until 012's 48-hour soak.
  - Preserve `JWT_SECRET` for share HMACs. Configure the old
    `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` together through the first
    new API startup so the idempotent NULL-project migration runs. Plan 012
    reruns both smoke scripts; old in-flight TUS uploads may be discarded as
    planned.
  - Plan 009 consumes `/api/storage/*` and `/api/search`; the live TUS and
    Range smokes pass. Plan 013 regenerates consolidated OpenAPI because 004
    deferred the old generator.
- **2026-07-23 (003 done)** — Auth is green. For plans 004/005/006/008/009:
  - Better Auth is mounted at `/api/auth/*`; `/api/me` returns the canonical
    `SafeUser`. Human sessions require an active Better Auth TOTP enrollment.
    Enrollment-only sessions cannot reach application or Better Auth admin
    routes. `admin` maps to legacy `superuser`.
  - `@repo/cloud-core/middleware` exports unified `auth`, `requireRole`, and
    `requireScope`. It accepts a Better Auth session or an API key from
    `Authorization: Bearer` / legacy `X-API-Key`; API-key project/scopes are
    propagated, while human sessions bypass scope checks. Plans 004/005/006
    should build on these primitives rather than add another auth layer.
  - Apps 008/009 should use `@repo/cloud-auth-client` (default base URL
    `https://api.denizlg24.com`, credentialed requests) and import wire
    contracts only from `@repo/schemas/cloud`.
  - Apply `packages/cloud-core/drizzle/0001_hesitant_landau.sql` after the
    existing baseline. The 003 migration defaults to dry-run and requires
    `--execute`; it preserves password hashes and pending-user completion
    tokens, writes an encrypted operator report, and never imports legacy
    TOTP/recovery material. Plan 012 owns execution and mandatory TOTP
    re-enrollment at cutover.
- **2026-07-23 (001 done)** — Foundation is green. For plans 002/011:
  - `apps/api` (Hono+Bun) exists with `/healthz` → `{ status, version }` and a
    `bun:test`. Scripts: `dev` (`bun run --watch`), `build` (`bun build … --outdir
    dist --target bun`), `typecheck`, `test`. `packages/cloud-core`
    (`@repo/cloud-core`) is an empty lib (`export {}`) — 002 fills it; keep it out
    of the Vercel apps (client contracts go in `packages/schemas`).
  - `apps/cloud` + `apps/storage` are Next 16 placeholders (standalone
    create-next-app tsconfig, mirroring `apps/web`; no `@repo/typescript-config`
    extend), each depending on `@repo/ui` via `transpilePackages` and rendering a
    Button to prove the transpile path. They have **no `test` script yet** (008/009
    add real tests) — `bun test` exits 1 on zero tests.
  - Dev infra: `bun run cloud:dev:infra` (needs `infra/compose/.env.dev`, copy from
    `.env.dev.example`). Brings up postgres:16 (:5433), mongo:8.2.11 single-node RS rs0
    (:27018, root auth, keyfile generated in-container), redis:7 (:6380, requirepass),
    meilisearch v1.38 (:7700, master key). All 4 reach healthy; a `mongo-init`
    one-shot does `rs.initiate`. **Host clients must use `directConnection=true`**
    (member host is `mongodb:27017`, only resolvable inside the compose network).
    Named volumes (`docker compose … down -v` to reset).
  - `vendor/deniz-cloud` submodule pinned at `94655ea`; excluded from Biome
    (`!vendor`) and from bun workspaces. Read-only.
  - CI (`ci.yml`) unchanged: new workspaces build with no env. A full-repo
    `bunx turbo build` locally still needs the root `.env` for web/desktop
    (pre-existing); the api/cloud/storage builds need none.
