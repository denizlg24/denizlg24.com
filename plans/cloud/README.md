# Cloud rewrite program — status

Entry point: `000-execution-runbook.md`. One plan per fresh session. Update
your plan's row when done (date + deviations). Executor = model that runs it.

| Plan | Title | Executor | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Workspace foundation (submodule, scaffolds, turbo, CI skeleton) | opus 4.8 | M | — | DONE 2026-07-23 (see Drift log in 001; deviations: Next apps use standalone create-next-app tsconfig like apps/web; `cloud:dev:infra` uses `--env-file`; mongo dev keyfile generated in-container + named volumes; biome `!vendor`; turbo build outputs +`dist/**`; cloud/storage have no `test` script yet) |
| 002 | Cloud core port (`@repo/cloud-core`: schema, services, middleware) | gpt5.6 | L | 001 | TODO |
| 003 | Auth: better-auth + API keys + cross-subdomain sessions | gpt5.6 | L | 002 | TODO |
| 004 | Storage engine (files, TUS, S3 `/v2`, shares, tiering) | gpt5.6 | XL | 003 | TODO |
| 005 | Projects platform (provisioning PG/Mongo/Redis, search sync) | gpt5.6 | XL | 003 (004 for storage folders) | TODO |
| 006 | Ops plane (scheduler, executors, metrics, health) | gpt5.6 | L | 003 | TODO |
| 007 | Terminal service rewrite (hardened, tmux-persistent) | gpt5.6 | M | 006 | TODO |
| 008 | `apps/cloud` admin app (dashboard, users, projects, DBs, tasks, terminal, observability) | fable 5 | XL | 003, 006 (007 for terminal tab) | TODO |
| 009 | `apps/storage` file browser app (browse, upload, preview, share, search) | fable 5 | XL | 003, 004 | TODO |
| 010 | UI consolidation & polish (shared components → `@repo/ui`, responsive, a11y) | opus 4.8 | M | 008, 009 | TODO |
| 011 | Infra & deploy (Tailscale, arm64 images, GHCR, compose, CI/CD) | gpt5.6 | L | 001 (finalize after 006) | TODO |
| 012 | Migration scripts, rehearsal & cutover runbook | gpt5.6 + operator | L | 002–011 | TODO |
| 013 | Decommission & docs (remove submodule, archive, dependent-project updates) | opus 4.8 | S | 012 in prod | TODO |

## Notes between sessions

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
