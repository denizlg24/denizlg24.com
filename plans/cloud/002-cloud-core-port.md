# Cloud 002: Port the core — Drizzle schema, services, middleware, contracts

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6
- **Effort**: L
- **Risk**: MED (contract fidelity — production data must load into this schema unchanged)
- **Depends on**: 001
- **Category**: backend / architecture

## Why

Every later backend plan builds on the data layer and service layer. The old
`packages/shared` is decent code buried in a drifting repo; we port it into
`@repo/cloud-core` with stricter boundaries, and lift API-facing types into
zod contracts consumable by the Vercel apps.

## Source material (read in `vendor/deniz-cloud`)

- `packages/shared/src/db/schema.ts` — 13 tables: `users`, `sessions`,
  `totp_secrets`, `recovery_codes`, `projects`, `api_keys`,
  `project_collections`, `project_databases`, `folders`, `files`,
  `tus_uploads`, `scheduled_tasks`, `task_runs`; enums incl.
  `db_type: postgres|mongodb|redis`, `storage_tier: ssd|hdd`,
  `collection_source_type: mongodb|postgres`, task enums.
- `packages/shared/src/db/connection.ts`, `drizzle.config.ts`, migration
  journal under `packages/shared/drizzle/`.
- `packages/shared/src/{services,middleware,types,env,mongo}/`.
- `packages/shared/src/auth/*` — port in plan 003, NOT here (leave stubs out;
  services that import auth primitives get ported in 003 if needed).

## Hard constraints

1. **Schema compatibility**: the production Postgres database is reused
   in-place at cutover. The ported Drizzle schema must describe the EXISTING
   tables byte-for-byte (names, types, defaults, indexes). Improvements are
   allowed only as NEW generated migrations that plan 012 will apply (e.g.
   missing FK indexes). Exception: auth tables will be restructured by plan
   003's migration — port them as-is anyway; 003 layers on top.
2. **No `any`/`unknown` casts.** Fix types properly.
3. **Boundaries**: `@repo/cloud-core` = server-only (postgres.js, mongodb
   driver, meilisearch client OK). Client-facing request/response shapes go
   to `packages/schemas` as zod (`packages/schemas/src/cloud/*` exported via
   a `./cloud` subpath) with types via `z.infer` only — repo convention.
   `@repo/cloud-core` may import `@repo/schemas`; never the reverse.

## Scope

### 1. Schema port + drift audit

Copy schema semantics into `packages/cloud-core/src/db/schema.ts` (rewrite
cleanly, don't paste blindly). Then audit against reality: run the dev infra
(`bun run cloud:dev:infra`), apply the OLD repo's migration set from
`vendor/deniz-cloud/packages/shared/drizzle/` to the dev PG, then run
`drizzle-kit` diff/generate against the new schema — **expected: empty diff**.
A non-empty diff means port drift: fix the port, not the DB. Keep a
`drizzle.config.ts` in `cloud-core` and commit the baseline migration state
so future migrations generate from parity.

### 2. Services port

Port `services/{auth,projects,collections,tasks}.ts` minus password/TOTP/JWT
primitives (003). Keep function signatures; improve internals freely
(transactions where the old code did read-modify-write, consistent error
types). Define a small typed error hierarchy in
`cloud-core/src/errors.ts` (`NotFoundError`, `ConflictError`,
`ValidationError`, `ForbiddenError`) and use it — the old code mixes throw
styles; Hono error mapping comes in later plans.

### 3. Middleware port

`middleware/{auth,cookie,rate-limit}.ts` → port rate-limit and the
scope-enforcement (`requireScope`, `requireRole`) logic and their tests.
The session/API-key resolution inside `auth.ts` is rewritten in 003 — port
its scope-propagation types (`AuthVariables`) now so signatures are stable.

### 4. Zod contracts

For every API-facing type in `shared/src/types/index.ts` (`SafeUser`,
`SafeProject`, `SafeApiKey`, `ApiKeyScope`/`API_KEY_SCOPES`,
`ApiResponse<T>`, `PaginatedResponse<T>`, plus DTOs used by the old
storage/admin UIs), author zod schemas in `packages/schemas/src/cloud/`.
These are the ONLY types the Vercel apps (008/009) may import. Preserve wire
shapes exactly where dependents rely on them (API key responses, share
payloads); mark improved shapes explicitly in the Drift log if you change any.

### 5. Support modules

Port `env.ts` helpers, `mongo/` client singleton, `search/{client,indexes,
storage,tokens}.ts`, `sync/{worker,pg-outbox,transform}.ts` compile-clean
with their tests. Deep functional rework of sync belongs to plan 005 — here
they must build, typecheck, and pass their existing ported unit tests.

### 6. Tests

Port the relevant old test files (old repo has 47; those covering the above
modules). Convert to the monorepo's `bun:test` style. All green.

## Verification

```
bunx turbo typecheck --filter=@repo/cloud-core --filter=@repo/schemas
bunx turbo test --filter=@repo/cloud-core --filter=@repo/schemas
# drizzle parity (documented in cloud-core/README.md as you set it up):
#   old migrations applied to dev PG, then drizzle-kit check → NO diff
bun run format-and-lint
```

## STOP conditions

Runbook STOPs, plus: drizzle parity diff you cannot attribute to a port
mistake (may mean prod schema drifted from old repo migrations — report,
don't guess); an old test encodes behavior that contradicts a locked
decision.

## Drift log

(record deviations here)
