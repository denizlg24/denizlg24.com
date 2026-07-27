# Envoy App

The public site and Hono/Prisma API for the Envoy encrypted environment-file
CLI. Envoy is a Bun workspace in the `denizlg24.com` monorepo; use the root
lockfile, Turbo tasks, Biome configuration, UI theme, and shared contracts.

## Development

From the repository root:

```bash
bun install
bunx turbo dev --filter=envoy
```

The app runs at `http://localhost:3006`.

Validation:

```bash
bunx turbo typecheck --filter=envoy
bunx turbo test --filter=envoy
bunx turbo build --filter=envoy
bun run format-and-lint
```

Database migrations use the Envoy-specific URL so they cannot target the cloud
API database accidentally:

```bash
bun --cwd=apps/envoy run db:status
bun --cwd=apps/envoy run db:migrate
```

## Configuration

All variables are documented in the root `.env.example` and passed through by
`turbo.json`.

- `ENVOY_DATABASE_URL`
- `ENVOY_GITHUB_CLIENT_ID`
- `ENVOY_GITHUB_CLIENT_SECRET`
- `ENVOY_CRON_SECRET`
- `ENVOY_S3_ENDPOINT` (`https://api.denizlg24.com/v2` in production)
- `ENVOY_S3_REGION`
- `ENVOY_S3_ACCESS_KEY_ID`
- `ENVOY_S3_SECRET_ACCESS_KEY`
- `ENVOY_S3_BUCKET`

Create a project and project-scoped S3 credential in the cloud admin, then
create a bucket matching the project slug. The app uses path-style S3
addressing, which is required by the denizlg24 cloud gateway.

## R2 cutover

Uploads go only to denizlg24 cloud S3. During the cutover, the old `R2_*`
variables provide a read-only fallback so existing CLI history remains
available.

Preview and execute the idempotent copy:

```bash
bun --cwd=apps/envoy run storage:migrate:r2 --dry-run
bun --cwd=apps/envoy run storage:migrate:r2 --execute
bun --cwd=apps/envoy run storage:migrate:r2 --verify
```

The migration never deletes R2 objects. Remove the four `R2_*` variables only
after the verify summary and an Envoy pull smoke test confirm the new bucket.

## Shared contracts

Canonical request/response schemas live in `@repo/schemas/envoy`. API
controllers validate both untrusted input and outgoing payloads, and the
marketing status client parses its response with the same contract.

Cross-language fixtures live in `apps/envoy-cli/contracts/v1`. The schema test
suite validates them with Zod, while the Rust CLI deserializes responses into
its production wire types and compares serialized requests exactly. Change the
Zod schema, fixture, server, and Rust type together when the protocol changes.

## Vercel deployment

Connect the monorepo repository to a dedicated Vercel project with:

- Root Directory: `apps/envoy`
- Framework Preset: Next.js
- Include source files outside the Root Directory: enabled
- Build Command: use the `vercel.json` default, which deploys pending Prisma
  migrations before building Envoy
- Install Command and Output Directory: automatically detected

Add every required `ENVOY_*` variable to the intended Vercel environments.
The build fails before deployment if `db:migrate` cannot bring the database
schema up to date. Keep the four `R2_*` variables during the storage copy and
pull smoke test, then remove them after cutover.

## Blob access API

All routes require an Envoy bearer token:

```text
POST /api/projects/:projectId/blobs/:hash/upload
GET  /api/projects/:projectId/blobs/:hash/download
PUT  /api/projects/:projectId/blobs/:hash/access
```

The access body is `{ "memberIds": ["<project-user-id>"] }`. An empty array is
owner-only; `null` removes a restriction. Existing blobs without a policy remain
available to all project members for backwards compatibility.
