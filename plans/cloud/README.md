# Cloud rewrite program — status

Entry point: `000-execution-runbook.md`. One plan per fresh session. Update
your plan's row when done (date + deviations). Executor = model that runs it.

| Plan | Title | Executor | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Workspace foundation (submodule, scaffolds, turbo, CI skeleton) | opus 4.8 | M | — | DONE 2026-07-23 (see Drift log in 001; deviations: Next apps use standalone create-next-app tsconfig like apps/web; `cloud:dev:infra` uses `--env-file`; mongo dev keyfile generated in-container + named volumes; biome `!vendor`; turbo build outputs +`dist/**`; cloud/storage have no `test` script yet) |
| 002 | Cloud core port (`@repo/cloud-core`: schema, services, middleware) | gpt5.6 | L | 001 | DONE 2026-07-23 (exact Drizzle parity against historical pre-0001 schema + old 0001–0007; baseline committed; deviations: old fresh-install SQL already contained 0001–0003, so audit reconstructed `8e7862c^`; raw-SQL constraint names modeled explicitly; `meilisearch` SDK 0.60 client-class rename hidden behind legacy `MeiliSearch` alias; password/TOTP/JWT/session resolution remains in 003 as planned) |
| 003 | Auth: better-auth + API keys + cross-subdomain sessions | gpt5.6 | L | 002 | DONE 2026-07-23 (Better Auth 1.6.25 + generated five-table forward migration; legacy Argon2id hashes preserved; pending signup, mandatory MFA enrollment, cross-subdomain sessions/CORS, Redis login limits, unified session/API-key middleware, and `@repo/cloud-auth-client` delivered. Deviations: operator chose mandatory TOTP re-enrollment because legacy OTPAuth secrets are incompatible with standard Better Auth behavior; no TOTP shim/secret import, legacy recovery codes invalidated, new backup codes issued at enrollment; client helper isolated from schemas. See 003/012 Drift logs.) |
| 004 | Storage engine (files, TUS, S3 `/v2`, shares, tiering) | gpt5.6 | XL | 003 | TODO |
| 005 | Projects platform (provisioning PG/Mongo/Redis, search sync) | gpt5.6 | XL | 003 (004 for storage folders) | TODO |
| 006 | Ops plane (scheduler, executors, metrics, health) | gpt5.6 | L | 003 | TODO |
| 007 | Terminal service rewrite (hardened, tmux-persistent) | gpt5.6 | M | 006 | TODO |
| 008 | `apps/cloud` admin app (dashboard, users, projects, DBs, tasks, terminal, observability) | fable 5 | XL | 003, 006 (007 for terminal tab) | TODO |
| 009 | `apps/storage` file browser app (browse, upload, preview, share, search) | fable 5 | XL | 003, 004 | TODO |
| 010 | UI consolidation & polish (shared components → `@repo/ui`, responsive, a11y) | opus 4.8 | M | 008, 009 | TODO |
| 011 | Infra & deploy (Tailscale, arm64 images, GHCR, compose, CI/CD) | gpt5.6 | L | 001 (finalize after 006) | IN PROGRESS 2026-07-23 (Tailscale off-LAN gate PASSED: macOS → `deniz-cloud-pi` at `100.89.155.9`, subnet `192.168.1.0/24`; preliminary ARM64 API image, production/staging compose, host units, GHCR deploy workflow, UFW/fail2ban/accept-both TLS, DDNS, and Vercel runbooks authored and locally verified. Finalization remains gated on 004–006 endpoint-complete Pi staging/load test + recorded memory peaks, 006 socket-proxy/reboot env contract, 007 terminal binary/unit/workflow integration, release workflow GHCR run, and operator application/verification of §5 network/TLS and §6 Vercel projects. Deviations: Redis AUTH failures require a 16 MiB ACL-log audit sidecar; optional Redis TLS uses new port 6381; admin tools are loopback-only under a compose profile.) |
| 012 | Migration scripts, rehearsal & cutover runbook | gpt5.6 + operator | L | 002–011 | TODO |
| 013 | Decommission & docs (remove submodule, archive, dependent-project updates) | opus 4.8 | S | 012 in prod | TODO |

## Notes between sessions

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
