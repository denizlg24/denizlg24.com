# Cloud 004: Storage engine — files, folders, TUS, shares, S3 `/v2`, tiering

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: gpt5.6
- **Effort**: XL
- **Risk**: HIGH (on-disk data + two public wire contracts: TUS and S3 SigV4)
- **Depends on**: 003
- **Category**: backend

## Why

The storage service is the largest external contract surface: the web UI
(009), TUS resumable uploads, HMAC share links, and an S3-compatible API that
external projects use with real S3 SDKs. All of it moves into `apps/api`
mounted under one host (`api.denizlg24.com`), preserving on-disk data and
wire behavior while cleaning up the implementation.

## Source material (`vendor/deniz-cloud/packages/storage-api/src`)

- `routes/{files,folders,uploads,share,search,s3}.ts`,
  `s3/{auth,errors,store,xml}.ts`, `utils/{path,fs,storage,project-access,
  share,content-disposition}.ts`, `cleanup.ts`, `config.ts`, plus
  `docs/S3_API.md` and `docs/storage-s3-v2.openapi.yaml`,
  `docs/storage-api.openapi.yaml` in the old repo.
- Recent old-repo fixes to preserve (git log): "stop large downloads aborting
  mid-stream", "preserve bucket errors for SDK clients", "prevent connection
  exhaustion".

## Hard constraints

1. **On-disk layout unchanged**: flat file paths + DB mapping, SSD/HDD tiers.
   Paths derive from env (`SSD_STORAGE_PATH` etc. — the Pi's mounts differ
   from defaults; never hardcode). Existing files must be served by the new
   code with zero data movement.
2. **S3 contract**: SigV4 signature validation must keep working (port
   `s3/auth.ts` faithfully — the endpoint change to `api.denizlg24.com` is
   fine because SDKs sign against the endpoint they're configured with). XML
   error/response shapes per `storage-s3-v2.openapi.yaml`. **Reality check
   (verified 2026-07-23)**: the old system has exactly ONE global S3
   credential from env (`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`;
   `s3/auth.ts` compares against `config.accessKeyId`, and
   `admin-api/src/routes/s3-credentials.ts` merely echoes that shared
   keypair). Per-project credentials DO NOT exist yet — they are a NEW
   feature of this rewrite (see "New capabilities" below). The single legacy
   keypair must keep validating after cutover (migrated as one credential
   row) so current consumers don't break before they rotate.
3. **Share links**: HMAC-signed stateless tokens (`fileId:expiresAt`,
   expirations 30m/1d/7d/30d/never). Existing issued links must stay valid →
   same HMAC construction + same secret at cutover.
4. **TUS**: resumable protocol per old implementation (`tus_uploads` table);
   in-flight uploads at cutover may break (acceptable; note in 012 runbook).
5. **HTTP Range** support on downloads (video/audio previews depend on it).

## Scope

1. Port routes into `apps/api` under `/api/storage/*` (files, folders,
   uploads, share) and `/v2` (S3) and `/api/search` (storage search). Route
   handlers thin; logic in `@repo/cloud-core/storage/*` modules. Auth via
   003's unified middleware; project-scoped API keys enforce
   `storage:read|write|delete` + project folder path boundary (port
   `utils/project-access.ts` semantics + tests).
2. Zod request/response contracts into `packages/schemas/src/cloud/storage.ts`
   consumed by 009 (align with the old OpenAPI yaml; regenerate OpenAPI from
   routes if the old repo's generation approach ports cleanly — else defer
   regeneration note to 013).
3. Port + strengthen streaming paths: verified fixes above; downloads use
   backpressure-aware streams; uploads fsync-then-commit metadata (keep the
   old atomic move semantics: copy → checksum verify → metadata update →
   delete source).
4. S3: port `s3/{auth,errors,store,xml}` with tests, incl. SigV4 test vectors
   generated with the AWS SDK against the local server (old repo has S3
   tests — port and extend: multipart? If the old `/v2` lacks multipart
   upload, do NOT add it now; record as future work).

### New capabilities (operator-requested — NOT in the old system; build here)

5. **Per-project S3 credentials**: new `s3_credentials` table (new Drizzle
   migration in `cloud-core`): id, projectId FK (nullable — NULL = the
   migrated legacy global credential), accessKeyId (unique, generated
   `DCS3` + random), secretAccessKey stored HASHED (SHA-256, like API keys)
   **plus** an HMAC-usable form: SigV4 derives signing keys FROM the secret,
   so the server must know it — store the secret encrypted at rest
   (AES-256-GCM with a key-encryption env secret, same pattern as old TOTP
   secrets) rather than hashed; label, createdAt, lastUsedAt, revokedAt.
   SigV4 validation resolves the access key from DB (cached in-memory w/
   short TTL), and **scopes the credential to its project's storage folder**
   — bucket/key operations outside the project prefix → S3 `AccessDenied`.
   Legacy env credential migrates to a NULL-project row with full access
   (rotation/retirement is a post-cutover operator task, noted in 012's
   change list). Issuance/rotation/revocation endpoints live in plan 005's
   project surface; validation + prefix enforcement live here. Tests: two
   projects' credentials cannot read each other's keys; revoked credential
   → `InvalidAccessKeyId`; legacy row retains old behavior.
6. **Tiering engine + on-access promotion** (schema has `storage_tier`
   ssd|hdd and per-file tier columns, but NO tiering code or cron was ever
   implemented — this is greenfield): implement `runTieringPass()` in
   `cloud-core/storage/tiering.ts` per `docs/PLAN.md §4.1 Tiered Storage
   Engine` rules — demote cold/large files to HDD when SSD usage crosses
   high watermark (config: watermarks, min age, min size, batch cap per
   pass), promote on access (download/preview of an HDD file updates
   lastAccessedAt and queues promotion; promotion is async, never blocks
   the download stream). ALL moves atomic: copy → checksum verify →
   metadata update → delete source; crash mid-move leaves both copies and
   a reconciler cleans up on next pass. Expose as the `tiering_pass` task
   type (006 registers the executor + default nightly schedule). Include a
   `--dry-run` report mode (what would move and why) surfaced in the admin
   UI (008). Tests with temp dirs: watermark math, atomicity under
   simulated crash (kill between copy and metadata update), promotion
   queue, dry-run accuracy.
7. **Bulk download as ZIP** (old PLAN.md Phase 5 item, never built):
   `POST /api/storage/download-archive` accepting file/folder id lists →
   streaming zip (store-only/no compression for speed on the Pi; stream
   entries sequentially, honor project-access and auth exactly like single
   downloads). Size guard (configurable cap, clear 413 error). 009 adds the
   multi-select UI.
8. Local verification harness: `apps/api/scripts/s3-smoke.ts` using
   `@aws-sdk/client-s3` (dev dep) against localhost — put/get/list/delete +
   range get + a share-link fetch, plus a per-project-credential prefix
   isolation check. Used again by 012 rehearsal.

## Verification

```
bunx turbo typecheck --filter=api --filter=@repo/cloud-core
bunx turbo test --filter=api --filter=@repo/cloud-core
bun apps/api/scripts/s3-smoke.ts        # against dev infra + dev api
bun run format-and-lint
# TUS: verify with tus-js-client script upload → interrupt → resume (add
# scripts/tus-smoke.ts; must complete after a simulated interruption)
```

## STOP conditions

Runbook STOPs, plus: any test only passes by weakening a wire contract
(signature check, XML shape, share HMAC); tiering pass cannot be made atomic
with the documented copy→verify→swap sequence.

## Drift log

- **2026-07-23:** The pinned old `/v2` implementation does support multipart
  upload. Multipart create/upload/list/complete/abort was therefore ported and
  covered by the AWS SDK integration test instead of being deferred.
- **2026-07-23:** A project credential's storage-folder prefix `/{slug}` is
  represented in the S3 namespace as the single exact bucket `{slug}`.
  Foreign bucket operations return S3 `AccessDenied`; NULL-project legacy
  credentials remain unrestricted. Plan 005 must use the exported credential
  helpers and invalidate `S3CredentialResolver` after create/rotate/revoke.
- **2026-07-23:** The legacy `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` pair is idempotently migrated at API startup into a
  NULL-project row. An access-key collision, project-bound row, or changed
  secret fails startup rather than weakening compatibility. Plan 012 must keep
  both variables through the first successful new-stack startup and assert the
  migrated row.
- **2026-07-23:** The old OpenAPI generation approach did not port cleanly to
  the consolidated Hono routes. Canonical Zod request/response contracts were
  added under `@repo/schemas/cloud`; OpenAPI regeneration is deferred to 013 as
  explicitly allowed by this plan.
- **2026-07-23:** Bulk archives use a sequential store-only ZIP32 stream.
  `STORAGE_ARCHIVE_MAX_BYTES` defaults to 2 GiB and is configurable up to
  4095 MiB so ZIP32 offsets remain valid; oversized selections fail before
  streaming with the documented 413 response.
