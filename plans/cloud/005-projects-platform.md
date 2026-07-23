# Cloud 005: Projects platform — provisioning (PG/Mongo/Redis), search & vector sync

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6
- **Effort**: XL
- **Risk**: HIGH (live dependents: per-project databases, Redis ACLs, Meili tenant tokens, mongot indexes)
- **Depends on**: 003 (uses 004's storage folders for project folder creation — coordinate via `cloud-core` service, stub if 004 not merged)
- **Category**: backend

## Why

"Projects" are the multi-tenancy backbone external apps depend on: scoped API
keys, private storage folders, provisioned databases (postgres | mongodb |
redis with per-project credentials/ACLs), MongoDB→Meilisearch sync,
Postgres-outbox→Meilisearch sync, S3 credentials, and mongot-backed
search/vector indexes. All state lives in the reused Postgres + the target
data stores; the rewrite must manage EXISTING provisioned resources, not just
new ones.

## Source material (`vendor/deniz-cloud`)

- `packages/admin-api/src/routes/{projects,project-databases,
  project-vector-indexes,s3-credentials,db-postgres,db-mongodb}.ts`
- `packages/admin-api/src/pg-client-factory.ts`
- `packages/shared/src/services/{projects,collections}.ts`,
  `search/{indexes,tokens,storage}.ts`, `sync/{worker,pg-outbox,transform}.ts`
- `scripts/infra/redis-acl-entrypoint.sh` (ACL users persisted to ACL file,
  per-project key-prefix restrictions), `scripts/infra/{mongodb-entrypoint.sh,
  mongo-rs-init.sh,mongot.yml}`, `docs/MONGODB_VECTOR_SEARCH.md`,
  `docs/SEARCH_MIGRATION.md`
- Compose env: `REDIS_ADMIN_URL`, `MONGODB_ADMIN_URI`, `MONGOT_HEALTH_URL`,
  `MONGOT_MAX_INDEXES_PER_PROJECT`, `MEILI_MASTER_KEY`.

## Hard constraints

1. **Existing resources keep working**: provisioned DB users/passwords, Redis
   ACL users + prefixes, Meilisearch per-project API keys
   (`meili_api_key_uid`/`meili_api_key` on `projects`), index naming
   `{projectId}_{collection}` (and slug-scoped `{slug}_*` key patterns),
   mongot search/vector indexes. The new code reads the same PG rows and
   must drive the same external state. No re-provisioning at cutover.
2. **Tenant tokens**: Meilisearch tenant token JWTs must validate against the
   same per-project keys so client apps' tokens survive until natural expiry.
3. **Sync correctness**: change-stream resume tokens (Mongo) and pg-outbox
   cursors are persisted state — new workers must resume, not re-sync from
   scratch (full resync stays available as an explicit admin action).
4. All Meilisearch index create/delete await `.waitTask()` (old repo learned
   this the hard way — keep it).

## Scope

1. Port project CRUD + API key issuance/rotation into `apps/api`
   `/api/projects/*`, logic in `cloud-core/projects/*`. Session auth = full
   access; API keys = scope-enforced (`search:read|write|manage`, storage
   scopes from 004).
1b. **Per-project S3 credential issuance (NEW — the old system only has one
   global env keypair; see plan 004 §New capabilities for the schema and
   validation design)**: endpoints under `/api/projects/:id/s3-credentials`
   — create (label, returns secret ONCE), list (metadata only, never the
   secret), rotate, revoke. Superuser session or `storage:manage`-scoped
   key. Credential is bound to the project's storage folder prefix
   (enforcement lives in 004's SigV4 layer). Old
   `admin-api/src/routes/s3-credentials.ts` (echoes the shared global
   keypair) is NOT ported — replaced by this.
2. Port provisioning engines with a common `Provisioner` interface per
   `db_type`:
   - postgres: role + database create/drop via admin connection
     (`pg-client-factory.ts` pattern; fix its pooling per old commit
     "prevent connection exhaustion").
   - mongodb: per-project db + user via `MONGODB_ADMIN_URI`.
   - redis: ACL user with key-prefix pattern via `REDIS_ADMIN_URL`; ACL
     persistence must survive container restart (the entrypoint script owns
     the ACL file — port script to `infra/` in plan 011; here implement the
     `ACL SETUSER`/`ACL SAVE` calls and tests against dev redis).
   Credentials returned once, stored per old schema (`project_databases`).
3. Port sync: `SyncWorker` (Mongo change streams, batched), pg-outbox worker,
   transform/field-mapping config, collection CRUD
   (`/api/projects/:id/collections`), pause/resume/resync, tenant token
   endpoint. Workers run inside `apps/api` (RAM budget — no extra container);
   add clean shutdown + crash-resume tests using dev infra.
4. Port mongot integration: search/vector index CRUD
   (`project-vector-indexes`), health check against `MONGOT_HEALTH_URL`,
   per-project index count limit. Keep API shapes; verify against
   `docs/MONGODB_VECTOR_SEARCH.md`.
5. Port the db-admin proxy surfaces (`db-postgres.ts`, `db-mongodb.ts` — the
   query/inspection endpoints the admin UI uses) with strict superuser guard.
6. Zod contracts for all of the above into `packages/schemas/src/cloud/`
   (008's project/database/collection screens consume them).
7. Tests: provisioning matrix against dev infra (create → connect as the
   provisioned user → CRUD → enforce prefix/db boundary → deprovision),
   sync end-to-end (insert/update/delete in Mongo → documents appear in dev
   Meili), tenant token validation, resume-token persistence across worker
   restart.

## Verification

```
bunx turbo typecheck --filter=api --filter=@repo/cloud-core
bunx turbo test --filter=api --filter=@repo/cloud-core   # incl. e2e sync suite vs dev infra
bun run format-and-lint
```

## STOP conditions

Runbook STOPs, plus: any behavior that would require re-issuing dependent
projects' credentials/tokens at cutover (defeats constraint 1) — report the
conflict instead of accepting it; mongot health/API differs from
`MONGODB_VECTOR_SEARCH.md` (doc drift — verify against old code, then
report what the real contract is in the Drift log).

## Drift log

(record deviations here)
