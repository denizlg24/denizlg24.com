# denizlg24.com Monorepo

## What this is

A personal "life OS" with exactly one user: Deniz, who is the owner, the only
admin, and the only person who ever sees any of it. The public portfolio site at
denizlg24.com is the only outward-facing surface; everything else — the `/admin`
dashboard in apps/web and the entire desktop app — is a private cockpit for
running Deniz's own life and infrastructure: contacts, email, blog, projects,
calendar, notes, kanban, resource/uptime monitoring, LLM usage, and an
agent-memory system that forms, consolidates, and retrieves memories about him
from his own data.

Consequences of being single-user — these are hard rules for UI work:

- **No explanatory copy.** Never add onboarding text, feature descriptions,
  "how it works" blurbs, tooltips that explain mechanics, or marketing-style
  labels. The owner built the feature; the UI assumes full context. Empty
  states stay empty or show a bare count/dash, not instructions.
- **Terse, data-dense surfaces win.** Prefer showing one more piece of data
  over a sentence of prose.
- **No multi-tenant thinking.** No roles, no per-user settings, no "your
  account" language. Auth is a single admin gate; module-level caches keyed per
  session (not per user) are fine.

**`apps/storage` is the one exception.** It serves Deniz's family — regular
cloud accounts on Macs, Windows laptops and iPhones — so the three rules above
invert there: explanatory copy, step-by-step guidance, friendly empty states
and plain-language labels are required, the default density is comfortable,
and owner-only detail (tier, checksum, ids) is hidden behind a superuser-only
pane rather than shown. The design is `docs/internal/plans/021-storage-app-overhaul.md`.
Family devices join the tailnet under the owner's own Tailscale identity, so
the network step of any device-setup flow is something the owner does, not
something a family member can be told to do.

**`apps/auth` is the second exception** (decided 2026-09-17). Family members
sign in through it to reach storage, and it is meant to serve other people's
users through an SDK one day, so product copy is allowed everywhere in it:
each flow screen asks one question with plain-language guidance, and the
management pages (owner-only) carry descriptions and empty states. Product
truth is `apps/auth/PRODUCT.md`, the built visual system `apps/auth/DESIGN.md`,
and the flow components live in `packages/auth-ui` — `packages/cloud-ui`'s
`auth-forms`/`auth-shell`/`totp` remain only for Forge's break-glass login.

## Structure

Turborepo monorepo (bun workspaces, single root `bun.lock`, Biome lint/format at root).

- `apps/web/` (formerly `portfolio-2026/`) — Next.js admin dashboard + API (backend), self-hosted on Forge. Manages portfolio content, contacts, blog, projects, email, calendar, etc. Uses MongoDB, shadcn/ui, Tailwind.
- `apps/desktop/` (formerly `denizlg24-app/`) — Tauri + Next.js desktop app (client). Consumes the web app's API. Minimalist/editorial design.
- `apps/api/` — Hono + Bun API for the self-hosted cloud. Runs on the Pi in
  Docker under compose, not through Forge.
- `apps/cloud/` — Next.js admin panel for the cloud (Forge).
- `apps/forge/` — Next.js Forge host and deployment dashboard, deployed by
  Forge through its own Dockerfile.
- `apps/storage/` — Next.js file browser (Forge).
- `apps/auth/` — Next.js sign-in, consent and OAuth client management for every
  app (Forge, `auth.denizlg24.com`). UI only: it talks to the API from the
  browser and holds no secrets. See [Auth](#auth).
- `apps/mcp/` — Hono + Bun MCP server for the whole infrastructure (Forge,
  `mcp.denizlg24.com/mcp`), MCP TypeScript SDK v2. An OAuth resource server;
  tools go in `src/tools/` and call upstream through `src/upstream.ts`.
- `apps/envoy/` — Next.js public site and Hono/Prisma API for the Envoy CLI
  (Forge). Uses project-scoped denizlg24 cloud S3 credentials; canonical wire
  contracts live in `packages/schemas/src/envoy`.
- `apps/envoy-cli/` — Rust `envy` CLI. This monorepo is the canonical source
  and release owner; `.github/workflows/release-envoy-cli.yml` publishes
  `envoy-v*` releases when its Cargo package version changes on `main`.
- `apps/authenticator-extension/` — Vite + React MV3 browser extension (Chrome
  and Firefox) holding an offline TOTP vault synced with
  `/api/admin/authenticator`. Uses `@repo/ui` for the design system.
  `.github/workflows/release-authenticator-extension.yml` publishes `ext-v*`
  releases when its package version changes on `main`. Directory and workspace
  name are both extension-specific so a second extension can sit beside it.
- `apps/terminal/` — compiled Bun web-terminal daemon. Runs on the Pi host under systemd, not in Docker.
- `apps/status/` — Next.js public status page (status.denizlg24.com). The one
  app still on **Vercel** (project `denizlg24-status`, scope `oceaninformatix`;
  env in `.env.status`, not `.env.example`). Its own Mongo on Atlas. See
  [Status page](#status-page).
- `packages/cloud-core/` — Pi-side cloud logic: drizzle schema, storage/S3, projects, ops, sync, middleware.
- `packages/cloud-ui/` — shared client pieces for the cloud apps.
- `packages/cloud-auth-client/` — cloud auth clients, the post-login redirect
  allowlist (`./redirect`) and the access-token verifier every resource server
  uses (`./resource`).
- `packages/typescript-config/` — shared tsconfig presets.
- `docs/internal/` — plans, architecture notes and deployment runbooks. Gitignored: present on the owner's machine, not in a fresh clone.
- `_archive/` — the original standalone repos with full git history (gitignored; read-only rollback material).

Tasks run through turbo: `bunx turbo build | typecheck | test | dev [--filter=web|desktop|api|cloud|storage|envoy|auth|mcp]`; `bun run format-and-lint` at root. `bun run dev:auth` runs api, auth (3008) and mcp (3009) together.

### Envoy CLI release ownership

- Do not restore subtree sync. `apps/envoy-cli` is maintained directly here,
  and the nested standalone-repository workflows were removed.
- CLI releases use `envoy-v<version>` tags so they cannot collide with tags for
  other applications in the monorepo.
- The updater and installers read releases from `denizlg24/denizlg24.com`.
- A release starts when the version in `apps/envoy-cli/Cargo.toml` changes on
  `main`; update `Cargo.lock` in the same change.
- Before archiving `denizlg24/envoy`, publish one final release there containing
  a build with the new update endpoint. Older installed binaries only poll that
  repository and otherwise cannot discover the monorepo release feed.

## The self-hosted cloud (apps/api, apps/cloud, apps/forge, apps/storage, apps/terminal)

Cut over to production on 2026-07-25, replacing the old standalone `deniz-cloud`
repo. That repo is gone: submodule removed, containers and images deleted, the
directory archived to the Pi's `BACKUP_DIR` as `decommission-*/deniz-cloud-repo.tar.gz`.

### Where things run

| Surface | Host |
|---|---|
| `api.denizlg24.com` | Pi, `apps/api` in Docker behind a Cloudflare tunnel. Serves `/api/*`, `/v2` (S3), `/healthz` |
| `denizlg24.com` | Forge, `apps/web` — the public site, the `/admin` dashboard and the API both other apps consume |
| `cloud.denizlg24.com` | Forge, `apps/cloud` |
| `forge.denizlg24.com` | Forge, `apps/forge` — it hosts itself |
| `storage.denizlg24.com` | Forge, `apps/storage` |
| `auth.denizlg24.com` | Forge, `apps/auth` |
| `mcp.denizlg24.com` | Forge, `apps/mcp` |
| `search.denizlg24.com` | Pi, Meilisearch published on loopback for legacy consumers |
| Postgres 5433 / Mongo 27018 / Redis 6380 | Pi, published publicly for dependent projects |

Deploys: push to `main` → CI builds `ghcr.io/denizlg24/deniz-cloud-api` (arm64) →
`docker compose -p deniz-cloud --env-file .env.pi -f docker-compose.pi.yml --profile tools up -d`
from `/opt/deniz-cloud/infra/compose` on the Pi. Every Next.js app is built and
run by Forge from its own Dockerfile except `apps/status`, which stays on
Vercel. Reach the Pi with `tailscale ssh denizlg24@pi-cloud` (no password).

Nothing that runs here sits behind a PaaS request limit — there is no 4.5 MB or
100 MB body cap on an upload route, and no platform-imposed function timeout.
What *is* finite is the host's memory, so a route that buffers a whole upload
competes with everything else on the box. `maxDuration` on a route is a Next.js
hint, not a platform ceiling.

### Things that will bite you

- **A Dockerfile in an app directory does nothing until the target says so.**
  `deploy_targets.framework` is a forced preset at enqueue: a target left on
  `nextjs` keeps building with nixpacks however many Dockerfiles land beside
  it. Flip `framework` to `dockerfile` (and clear `startCommand` /
  `buildCommand`, which the Dockerfile path refuses or, worse, honours — a
  leftover `bun run start` override runs `bun` inside a `node` image) *before*
  pushing; a deploy in between fails harmlessly, the live container stays.
- **`apps/web` builds and runs on glibc — trixie, not bookworm; the other Next
  images are alpine.** The Tectonic binary `node-latex-compiler` ships is
  dynamically linked against glibc **2.39+** (bookworm has 2.36 and refuses it
  at exec), libssl 3 and graphite2, and bun installs the sharp/resvg
  platform packages for the libc it runs on, so an alpine install stage hands
  a Debian runtime the musl builds. Switching either stage "for consistency"
  breaks CV compile, `next/image` or whiteboard rendering at runtime, not at
  build. `LATEX_TECTONIC_PATH` names the copied binary; nothing traces it.
- **A Forge build runs `next build` under Bun; CI runs it under Node.** `bun run`
  hands a `#!/usr/bin/env node` bin to node when node is on PATH, and the runner
  has one — the `oven/bun:*-alpine` build stages do not, and the nixpacks targets
  pass `--bun` outright. So a green CI build says nothing about whether the same
  commit deploys. Bun below **1.4.0** segfaults on every Next 16.3 build here
  (oven-sh/bun#36866: next-swc's threads release a napi threadsafe function after
  the page-data worker that created it is gone). It can crash *after* the build
  finishes — a full route table and `exit 139` is this, not a broken app.
- **`bunx` is not covered by the Bun version pin unless it is placed too.**
  `injectBunVersion` copies `bun` into `/usr/local/forge-bin`; `bunx` in
  `oven/bun` is an absolute symlink to a path the nixpacks image lacks, so it
  cannot be copied and is symlinked instead. Every Turborepo target here opens
  its build command with `bunx`, so without that link the build silently runs
  nix's Bun 1.3.0 while the log says the pinned version was copied in. Read the
  version off the crash report or `bun --version` in the build, never off that
  log line.
- **Restarting the API by hand silently downgrades it.** `API_IMAGE=` is empty in
  `.env.pi` on purpose: the deploy passes it inline, as
  `API_IMAGE=ghcr.io/denizlg24/deniz-cloud-api:<40-char sha> API_VERSION=<sha>`.
  A plain `docker compose --env-file .env.pi ... up -d api` therefore takes the
  compose default, `:latest`, which on the Pi is whatever was pulled last — it
  was a month stale when this bit. Omitting `-f docker-compose.posix.yml` on a
  `STORAGE_NAMESPACE_MODE=broker-mounted` box drops the storage mounts in the
  same breath. The whole command is:

  ```
  API_IMAGE='ghcr.io/denizlg24/deniz-cloud-api:<sha>' API_VERSION='<sha>' \
    docker compose -p deniz-cloud --env-file .env.pi \
    -f docker-compose.pi.yml -f docker-compose.posix.yml up -d api
  ```

  Nothing fails when you get this wrong — the container starts, `/healthz`
  answers, and it serves the old build. `/healthz` reports `version`, which is
  `API_VERSION`: if it says `latest` rather than a sha, the wrong image is
  running.
- **The healthcheck does not mean ready.** `createRuntimeApp()` is built lazily on
  the first `/api/*` request and `/healthz` sits outside `/api/*`. A container can
  report healthy having seeded no tasks, reconciled no Redis ACLs and started no
  workers. After any deploy, hit `/api/me` (expect 401) and confirm
  `scheduled_tasks` still holds the schedules you expect.
- **Never read `c.res` before `await next()` in Hono middleware.** Doing so makes
  Hono rebuild the response via `new Response(res.body, res)`, which converts a
  `Bun.file()` blob into a stream, drops `Content-Length`, forces chunked encoding
  and loses `sendfile`. Large downloads then buffer in userspace until the process
  is OOM-killed. `packages/cloud-core/src/middleware/cors.ts` exists solely because
  `hono/cors` does this.
- **Serve files as `Bun.file()` / `.slice()`, never a hand-rolled ReadableStream.**
  Measured on a 5.8 GB file to a slow client: BunFile 36 MB steady, pull-stream
  607 MB then OOM. Keep `idleTimeout: 0` in `apps/api/src/index.ts`.
- **Never read a large file with `Bun.file(path).stream()` either.** Reading a
  629 MB file grew RSS by 680 MB that `Bun.gc(true)` would not reclaim; an
  `fs.open()` descriptor read into one reused `Buffer` grew it by 3 MB. This is
  why `writeArchive` and `computeChecksum` look the way they do. Anything that
  has to pass file bytes through JS — hashing, ZIP building, copying — reads
  through a descriptor into a fixed buffer, and multi-file work (ZIP downloads)
  is staged to disk first and then served as a `Bun.file()`.
- **UFW `INPUT` policy is DROP.** Containers cannot reach host services unless a
  rule allows the docker subnets. This is why the terminal needs
  `ufw allow from 172.16.0.0/12 to any port 3003 proto tcp`.
- **The terminal binds loopback or the Tailscale address, never a public one**, and
  runs as root only with `TERMINAL_ALLOW_ROOT=1`. It is a compiled binary
  (`bun build --compile --target=bun-linux-arm64`) installed at
  `/usr/local/bin/cloud-terminal`, shipped by `release-cloud-terminal.yml` on
  every push to `main` that touches `apps/terminal`, `apps/storage-metadata`,
  `cloud-core`, `schemas` or the lockfile.
- **`apps/storage-metadata` rides the same workflow, and its ordering matters.**
  It is a compiled binary at `/usr/local/bin/cloud-storage-metadata` under
  `deniz-cloud-storage-metadata.service`; the workflow installs it and restarts
  the unit while preserving the storage boundary target. It needs no approval,
  whereas the `Release cloud API` workflow's **Deploy to Pi job waits on a manual
  environment approval** — so a push that changes both lands the host binary
  first, which is the order a new socket op needs. Because the API keeps working
  against an old service, nothing reports a metadata release that failed: check
  the workflow, not `/healthz`. For a hotfix without a push: `bun run build:pi`,
  then `dd` the binary over (a shell `cat` corrupts it), `install -m 0755`,
  `systemctl restart`.
- **Storage files must be owned by uid 1000.** The API runs unprivileged as `bun`;
  anything written as root makes deletes, renames and uploads fail with EACCES
  while reads keep working.
- **Secrets that cannot change**: `JWT_SECRET` (share links),
  `DATABASE_CREDENTIAL_ENCRYPTION_KEY` (= the old `TOTP_ENCRYPTION_KEY`; project DB
  passwords), `S3_CREDENTIAL_ENCRYPTION_KEY`, and the legacy `S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` pair that dependent projects still sign with.
- **S3 buckets are directories under `<SSD>/.s3-v2` with a `bucket.json`.** A
  per-project credential is restricted to one bucket named exactly the project
  slug, and that bucket is not created at provisioning time — the first
  `CreateBucket` makes it. Wrong bucket reads as `AccessDenied`, missing bucket as
  `NoSuchBucket`.
- **Nightly tiering is two tasks, and only one is right for a deployment.**
  `tiering_pass` is the legacy mover (SSD tree ↔ flat UUID store on the HDD);
  `namespace_tiering` is the broker one (same relative path on both branches,
  moved by the privileged host service). `seedDefaultOpsTasks` seeds whichever
  matches `STORAGE_NAMESPACE_MODE` and disables an enabled legacy row on a
  broker box; `/storage/tiering` and the `/disks` panel resolve the type the
  same way. Anything new that names `tiering_pass` literally will silently do
  nothing in production once the broker cutover lands. `namespace_checksum` is
  seeded alongside the broker one, an hour earlier, and is what makes it able to
  move anything at all.
- **The broker pass only moves on the watermark.** Age and size choose *which*
  files go, never *whether* any do. Both branches carry the same path, so
  demoting off a half-empty SSD relocates data for no reason. The legacy pass
  demotes on age or size alone because HDD placement there is also the
  addressing scheme.
- **Age and size rank the batch, they no longer filter it.** They used to be
  ANDed into `selectDemotions`, which let them decide *whether* after all: a
  namespace whose big files were recent and whose old files were small stayed
  above the high watermark forever with the pass reporting nothing to do. Files
  a rule names go first (`large`, then `cold`), and the coldest of the rest fill
  the rest of the gap under `watermark`, which is the only reason that can reach
  the target on its own. `planReason` on the report row says which applied —
  distinct from `reason`, which is why a non-`moved` outcome happened.
- **Nothing tiers until `namespace_checksum` has run.** A tier move verifies the
  copy against the recorded checksum, and only an API upload writes one: an
  entry adopted from SMB is stamped `checksumState: "pending"` and stays there.
  `recordChecksum` — the one operation that reaches `verified` — had no caller at
  all, so 81% of the store was unmovable regardless of disk pressure, and
  `assign`'s comment about the projector recomputing it described work that was
  never written. The backfill hashes those rows through the broker mount with
  `computeChecksum` and stamps the xattr over the socket, so the value survives
  re-projection. `verified` on the tiering report is what separates "nothing
  needs moving" from "nothing *can* move yet". A checksum the host proves stale
  (`deferred` / `source-changed-during-copy`, which is what an SMB overwrite
  leaves behind) is cleared so the next backfill recomputes it.
- **`files.tier` is a hint in broker mode, not a fact.** The projector never
  writes it; the branch holding the path is the authority. The pass over-reads
  by `placementLookahead`, asks `tier-locate` where each path actually is, and
  repairs stale rows before selecting — otherwise one drifted row leads every
  batch forever.
- **`STORAGE_MIGRATION_MODE` and `STORAGE_RESTORE_ACTIVE` need a container
  restart.** They are read once when `storageConfigFromEnv` runs. Setting one
  mid-restore does nothing until the API bounces, so bounce it — or disable the
  task — before starting the work they are meant to guard.
- **Branch tiering ops answer UNAVAILABLE until the host declares its roles.**
  `STORAGE_SSD_BRANCH_PATH` / `STORAGE_HDD_BRANCH_PATH` on
  `apps/storage-metadata`, both or neither. Unset means the pass reports
  `blockedBy: branch-usage-unavailable` — it never reads that as an empty
  namespace. And as with every change to that service, the host binary must be
  live before the API starts calling a new op — the terminal release lands
  without approval, the API release waits for one, so pushing both together
  gives the right order.
- **`tiering_pass` is live** as of 2026-07-26: enabled, `0 3 * * *`,
  `dryRun: false`. The gate it used to sit behind — review a dry run before
  arming it — has been passed. It genuinely relocates data between physical
  disks on every run, so treat changes to `packages/cloud-core/src/storage/tiering.ts`
  and to the watermark/age/size thresholds as production changes, and rehearse
  with a dry run first (`/disks` has the button, or set `dryRun: true` on the
  task config).
- **A tiering pass that fails on individual files still reports `completed`.**
  Per-file failures land in `metadata.tieringReport.failures`, not in the run
  status, so no task-failure notification fires for them. Read the report, not
  just the status.
- **A missing source blob is no longer a failure — the pass resolves it.**
  `ENOENT` on the copy routes into `resolveMissingSource`, which reports the
  file as `vanished` (row gone or moved since the batch was listed — the
  concurrent-delete race), `healed` (a verified blob was already at the
  destination, so the row is repointed), or `orphaned` (gone from both tiers,
  so the row is deleted and dropped from Meili, and a `tiering_orphaned`
  notification fires). Reaping requires the tier root to be non-empty: an
  unmounted disk makes every blob look deleted, and that path reports a failure
  instead of emptying the `files` table.
- **`files.mime_type` is null for most of the namespace, so nothing may key a
  decision on it alone.** It comes from a protected xattr only an API upload
  writes; 81% of rows have none, and 19 more carry a bare
  `application/octet-stream` from a tus client that did not care. With `nosniff`
  on, declaring that made every image, clip and PDF written over SMB unviewable.
  `mimeTypeForFilename` in `packages/schemas/src/cloud/file-types.ts` is the one
  table both sides use — `fileResponse` to declare a Content-Type and the storage
  app's `fileKind` to pick a renderer, which is why that classifies on the
  extension first and the MIME second. `isActiveContent` runs against the
  *resolved* type, so a derived `image/svg+xml` is still forced to download.
  An unknown extension is not refused: the preview reads a bounded head and
  decides text or binary from the bytes.
- **Thumbnails are subprocesses, and the cache is derived data.**
  `packages/cloud-core/src/storage/thumbnails.ts` spawns `vipsthumbnail`
  (images, PDFs; `vips-heif` for iPhone HEIC) and `ffmpeg` (a video poster
  frame) with `nice -n 10`, two at a time, 20 s each, into
  `STORAGE_THUMBNAIL_PATH` (default `<SSD>/.thumbs`), keyed
  `<w>/<id[0..2]>/<id>-<size>-<mtime>.webp`. Never a native module: `sharp`'s
  libvips cannot decode HEVC HEIC and its heap never shrinks. The API image
  installs `vips-tools vips-heif vips-poppler ffmpeg`; without them every
  thumbnail is a logged failure and the tile shows the glyph. `thumbnail_backfill`
  (nightly, 2 000/run) and `thumbnail_gc` (weekly) are seeded at boot — their
  enum values are migration **0046**, applied by hand before the API rolls.
  Upload finalize and the projector push ids onto `storage:thumbnails:warm` in
  Redis; one worker drains it. `rm -rf` of the cache is always safe.
- **A folder created through the API is stamped on create**, and adoption
  consults the projection before minting: a row at the path inserted in the
  last 60 s lends its id (`adoptWithProjectionClaim`). Before this, the watcher
  re-minted every new folder and the id the client held answered 404 until a
  refresh. `smb-sessions` on the host socket is the only writer of
  `smb_credentials.last_authenticated_at`; the API asks for it on every device
  list and persists anything newer, so the column fills only once the
  hand-deployed host binary carries the op.

### Migration and cutover scripts

`apps/api/scripts/` (`cutover:*` in its package.json) share one harness in
`scripts/lib/runner.ts`: dry-run by default, `--execute` required to write,
`--dry-run` and `--execute` together is an error, JSONL audit log via `--log`, one
JSON summary line on stdout, and marker rows in `auth_verification` enforcing
order (schema → users → s3). Full reference in `docs/internal/cutover/`.

## Auth

One identity for everything: the cloud's Better Auth user, TOTP mandatory. The
API (`api.denizlg24.com`) is the only thing that holds or checks it, and it is
also the OAuth 2.1 authorization server (`@better-auth/oauth-provider`, issuer
`https://api.denizlg24.com/api/auth`, EdDSA JWTs, JWKS at `/api/auth/jwks`).
`apps/auth` is its login/consent/client-management UI. Canonical identifiers
(issuer, auth app, resources, the `superuser` scope and claim) live in
`packages/schemas/src/cloud/oauth.ts`; each app reads an env override first.

| Party | Resource (`aud`) | How it gets a token |
|---|---|---|
| MCP clients (Claude) | `https://mcp.denizlg24.com/mcp` | Dynamic registration + authorization code + consent on auth.denizlg24.com |
| `apps/web` | `https://denizlg24.com` | Trusted client, authorization code, no consent step |
| `apps/desktop` | `https://denizlg24.com` | `native` public client: authorization code + PKCE, system browser, loopback redirect, no consent step |
| `apps/mcp` → API, web and status | `https://api.denizlg24.com`, `https://denizlg24.com`, `https://status.denizlg24.com` | `client_credentials` as a service client |
| `apps/status` → web | `https://denizlg24.com` | `client_credentials` as a service client, to start the incident triage run |
| MCP server → `apps/status` | `https://status.denizlg24.com` | bearer on `/api/admin/*`; the admin UI keeps using the cloud cookie |

- **Forge's edge strips every `deniz-cloud.*` cookie before a request reaches a
  deployment** (`apps/deploy-agent/src/caddy.ts`), on purpose — no deployed
  app may hold the cloud credential. So no Forge-hosted app can check the
  cloud session server-side. cloud/forge/storage/auth only use it from the
  browser against the API; web and mcp get server-verifiable identity from
  access tokens. status reads the cookie server-side only because it runs on
  Vercel.
- **Every token is a superuser token, enforced at issuance and every refresh.**
  `customAccessTokenClaims` in `apps/api/src/auth/better-auth.ts` throws for
  anyone but an active, TOTP-enrolled, unbanned superuser, and a Hono gate
  refuses non-superuser sessions at authorize/consent/continue. User tokens
  carry `superuser: true`; machine tokens carry `scope superuser` and `owner`,
  the superuser who created the service client. `isSuperuserToken` in
  `@repo/cloud-auth-client/resource` is the one test resource servers apply.
- **The API accepts its own `aud=api` tokens as a superuser session**
  (`apps/api/src/auth/oauth-bearer.ts`, `sessionId` prefixed `oauth:`), so
  `requireSession()` routes are open to the MCP server. It re-checks the owner
  on every request: demoting or banning cuts a service client off before its
  five-minute token expires. `/api/oauth/*` (client management) refuses
  `oauth:` sessions so a leaked service secret cannot mint more clients.
- **A token for one resource is refused by every other.** The MCP server never
  forwards the token Claude presented; `apps/mcp/src/upstream.ts` holds its own
  per-resource `client_credentials` tokens (`MCP_OAUTH_CLIENT_ID/SECRET`).
- **Dynamic registration is open** (MCP clients register themselves) but can
  only ever reach the MCP resource and the user-delegated scopes. A
  registration whose every redirect is plain-http loopback is rewritten to
  `application_type: "native"` before the plugin sees it — the plugin defaults
  to `web`, which refuses the `http://localhost` callbacks Claude Code uses.
- **web keeps its own session, `__Host-denizlg24-admin`**: a sealed access +
  refresh token pair (15-minute access, 30-day sliding refresh). `proxy.ts`
  refreshes before handlers run and rewrites the request cookie so the same
  request sees it; it never clears the cookie on a refused refresh, because a
  second container losing a concurrent-refresh race gets `invalid_grant` while
  the winner's cookie is good. The sealing key is derived from
  `WEB_OAUTH_CLIENT_SECRET`, so rotating that secret signs every browser out.
  `/auth/logout` revokes the grant and ends the cloud session via the auth app.
- **Desktop is a public client and learns its config from web, not a build.**
  `GET /api/public/desktop-auth` on web returns `{ issuer, clientId, resource }`
  from `DESKTOP_OAUTH_CLIENT_ID` plus the same `siteResourceConfig()` web
  verifies with, so the binary carries no environment identifiers and a client
  rotation is a web env change, not a desktop release. The client is created
  as kind `native` on auth.denizlg24.com/clients with redirect
  `http://127.0.0.1/callback` (plus `http://localhost/` for the browser dev
  fallback); the plugin strips the loopback port, so the app binds any free
  one at runtime (`oauth_listen` in `src-tauri/src/main.rs`). Tokens live in
  `auth.json` under plugin-store, refresh is single-flight in
  `lib/auth/session.ts`, and only `invalid_grant`/`invalid_client` on refresh
  signs the device out — a network failure keeps the session. `requireAdmin`
  already accepted these tokens as `via: "oauth"`; the `ApiKey` model stays for
  the authenticator extension.
- **Forge's own `/login` is a break-glass, not dead code.** Normal sign-in goes
  to auth.denizlg24.com, which Forge itself deploys; a broken auth release
  would otherwise lock the owner out of the tool that rolls it back, and a
  disaster recovery bootstraps from the generated forge-server host.
- **better-auth ≥1.7.3 refuses to start while `auth_account.issuer` is NOT
  NULL** (`SCHEMA_MISMATCH` on every auth call). 1.7.0–1.7.2 required it
  (migration 0040); 0044 relaxes it. Never roll an API past 1.7.2 onto a
  database without 0044. `apps/macros` is pinned to better-auth 1.7.1 on
  purpose — it has its own database and was not part of this upgrade.
- **Keep web's Mongo `user` collection.** Sign-in no longer uses it, but agent
  memory reads its one document as the owner's identity and its `_id` as the
  owner node's id. `session`, `account` and `verification` are dead.
- **"Remember me" is a refresh-token handle, not a longer session.** The
  login checkbox (default on) flags the cloud session (`auth_session.remember_me`,
  0045), and a first-party client (`skipConsent`: web, desktop) authorizing from
  such a session receives `rm_<family>.<hmac>` in place of a refresh token — a
  stable name for the grant's `authorizationCodeId` family. The provider still
  rotates rows underneath; `apps/api/src/auth/remember-me.ts` resolves the handle
  to the family's live row and stamps it non-expiring, so a phone that lost a
  token response is still signed in and nothing runs out until the handle is
  revoked (sign-out, MFA reset, account gone). MCP clients are excluded and keep
  30-day rotating tokens. The cloud session's own 24 h is untouched. Two plugin
  facts the module is built around: refresh tokens are SHA-256 hashed at rest
  (`storeTokens` is now ours so the hash is pinned), and
  `formatRefreshToken.encrypt` is called **synchronously** — its result is
  concatenated, not awaited — so the awaited hooks resolve everything into
  `AsyncLocalStorage` state first, which is why `app.ts` wraps the auth handler
  in `withOAuthRequestState`. Unchecked is Better Auth's real `rememberMe:
  false`: a browser-session cookie, rotating tokens as before.
- **A passkey is both factors.** `@better-auth/passkey` (pinned to the
  better-auth version; 1.7.5 peers on a newer core) signs in on
  `/passkey/verify-authentication`, which the twoFactor hook does not match,
  so there is no TOTP step. That is why `apps/api/src/auth/passkey.ts`
  requires a resident, user-verified credential at registration and refuses
  an assertion whose authenticator did not verify the user — the plugin
  itself verifies with `requireUserVerification: false` on both ceremonies.
  The rpID is the cookie domain (`denizlg24.com`; `PASSKEY_RP_ID` overrides)
  because the plugin's default is the *API's* hostname, which no browser on
  auth.denizlg24.com can use; the origin list pins ceremonies to the auth
  app. Rows live in `auth_passkey` (0050) and are managed at
  auth.denizlg24.com/security. A passkey session is always remember-me: the
  path is not `/sign-in/*` and carries no flag, so the session hook falls
  through to the cookie branch.
- **"Trust this device" is the plugin's own `trustDevice`**, a signed
  `deniz-cloud.trust_device` cookie backed by an `auth_verification` row
  (`trust-device-*`, value = user id) that the credential sign-in hook checks
  and **re-issues on every sign-in**. `trustDeviceMaxAge` is a year, so it is
  how long a device may go unused, not a re-prompt interval. The plugin never
  lists or revokes trust: `GET/POST /api/auth/trusted-devices[/revoke]`
  (`apps/api/src/auth/trusted-devices.ts`) count and delete the rows. The
  cookie only ever reaches the API — Forge's edge strips it with the rest of
  `deniz-cloud.*`.

Rollout order for anything touching this: apply cloud-core migrations (0043
OAuth tables, 0044 issuer, 0045 remember-me, 0050 passkeys) → roll the API (manual approval) → deploy auth and
mcp on Forge → create the web and mcp clients on auth.denizlg24.com/clients →
set `WEB_OAUTH_CLIENT_ID/SECRET` on web and `MCP_OAUTH_CLIENT_ID/SECRET` on mcp
→ deploy web. Web deployed before its client exists cannot sign in. Desktop
sign-in additionally needs the `native` client created and
`DESKTOP_OAUTH_CLIENT_ID` set on web; until then the app's sign-in button
reports that the server is not configured, and nothing else is affected. The
in-app agent's denizlg24 connector likewise needs a `service` client holding
only the MCP resource, set as `WEB_MCP_OAUTH_CLIENT_ID/SECRET` on web; until
then the connector reports unconfigured and chat runs on its built-ins. Deploy
mcp before web whenever web starts relying on a new MCP action. The client
management API cannot add a resource to an existing client, but the binding
is one row in `auth_oauth_client_resource` (`client_id`, `resource_id` = the
identifier) and the resource one row in `auth_oauth_resource`; the plugin
seeds configured resources insert-only, so a hand-inserted row survives the
next deploy. That is how the MCP client gained the status resource on
2026-09-15 without rotating its secret — `docker exec -i
deniz-cloud-postgres-1 psql -U admin -d denizcloud` on the Pi.

## Status page

`apps/status` collects once a minute (`/api/collect`, Vercel cron): its own
probes of every app, the API's `/healthz/status`, Better Stack monitors and
heartbeats. Design and rollout: `docs/internal/plans/022-status-incident-rules-and-agent.md`;
operator side: `docs/internal/runbooks/status-incident-agent.md`.

- **One failed observation is a degradation, three in a row are an outage.**
  `confirmStatus` in `lib/health.ts` derives the status the page shows from
  the raw verdict (`observed`) and the preceding samples' raw verdicts: `down`
  needs `DOWN_CONFIRM_OBSERVATIONS` (3) consecutive, leaving `down` or
  `degraded` needs `RECOVER_OBSERVATIONS` (2) clean ones, and `unknown` holds
  the last confirmed status for 10 observations. Consequence worth knowing: a
  service failing four minutes in five reads `degraded`, never `down`, and
  opens no incident. Samples store both `status` (confirmed; what the daily
  buckets count) and `observed`.
- **Better Stack's `down` needs corroboration.** It checks every few minutes
  and its verdict is sticky — a monitor reads `down` until its next check, an
  incident stays open through its recovery period — so re-read each minute,
  one failed check looked like three fresh failures and confirmed an outage
  on its own (a 2-minute auth deploy swap became an incident on 2026-09-15).
  `summarizeService` counts a Better Stack `down` as `degraded` whenever the
  service's own evidence has a fresh pass and no failure; it stands when our
  probe agrees or has nothing to say.
- **A dependency's *confirmed* outage degrades its dependents; its blips do
  not.** The dependency pass runs after confirmation, on confirmed statuses,
  and adds at most `degraded`.
- **Incidents are derived here, not mirrored.** `planIncidents` in
  `lib/incidents.ts` opens `auto:` incidents on a confirmed `down`, merges
  services related through `incidentRelations` into one, posts a public
  `monitoring` update on recovery and resolves `AUTO_RESOLVE_MINUTES` (5)
  later; a regression clears `recoveredAt`. Better Stack incidents are
  evidence only, linked by id when one coincides so acknowledge/resolve and
  the enrichment comment reach it; the `betterstack:` rows that exist are
  history and only follow their upstream to resolution. Heartbeats never open
  incidents — before this, 28 of 60 incidents had no service at all.
- **An open incident no longer forces a tile red.** `data.ts` shows the
  confirmed status; an incident is the narrative on top. Incidents with no
  service are not shown publicly.
- **Maintenance is applied in the collector**, so a service in a window is
  `maintenance` in the snapshot and the samples, never builds a down streak
  and never opens an incident. `repeat: "weekly"` recurs at the same weekday
  and time (`maintenanceCovers`); one row covers the Sunday 02:00 UTC reboot.
- **Every automatic incident starts one triage run on denizlg24.com**
  (`lib/agent.ts`, `POST /api/admin/background-agent/runs` with a token from
  `STATUS_OAUTH_CLIENT_ID/SECRET`), unless one of its services had a run in
  the last hour. The run's verdict (`transient` / `operational` / `code`) lands
  on the incident through `status_incidents update`; `code` escalates through
  `status_incidents escalate`, which opens the GitHub issue
  (`STATUS_GITHUB_TOKEN`, labels `incident` + `agent-fix`) and then fires the
  "Incident fixer" Claude Code routine through its API trigger
  (`lib/routine.ts`, `STATUS_ROUTINE_FIRE_URL/TOKEN`) with the issue in the
  payload. Not a GitHub trigger: routines only take pull request and release
  events, so no issue event can start one. The routine also sweeps daily for
  anything a failed fire missed. Unset credentials skip each step silently:
  the incident still opens.
- **A routine's connector tools are gated by `permitted_tools`, not
  `allowed_tools`.** Every tool of an attached connector is otherwise callable
  without approval. The Incident fixer permits only the read tools plus
  `status_incidents`; anything else hits a permission prompt nobody answers,
  so the run stalls rather than restarting or redeploying something. Its
  sandbox has no `gh` (it uses the built-in GitHub tools) and Bun 1.3.
- **The admin API and the server actions share `lib/admin-ops.ts`.** Routes
  under `app/api/admin/*` authenticate with `requireActor` (bearer for the
  status resource, else the cloud cookie) and go through `adminRoute`; every
  write is audited under the actor (`client:<id>` for the MCP server).
  Input contracts are `@repo/schemas/status`.

## apps/mcp tools

Every admin action of the infrastructure is a tool: `src/tools/forge/`
(`/api/deploy` + `/api/forge`), `src/tools/cloud/` (`/api/ops`, `/api/projects`,
`/api/db/*`, `/api/auth/admin`), `src/tools/storage/` (`/api/storage`,
`/api/search`), `src/tools/web/` (`/api/admin/*` on denizlg24.com) and
`src/tools/status/` (`/api/admin/*` on status.denizlg24.com). The
catalogue with every tool → route mapping is
`docs/internal/plans/020-mcp-full-tool-catalogue.md`.

- **Two shapes, one helper each** (`src/tools/define.ts`). Infra is
  per-operation (`defineTool`, one precise schema, e.g. `forge_target_update`);
  web is per-resource with an `action` enum (`defineActions`, e.g. `web_blogs`
  with `list|get|create|update|toggle|delete`). Id-only transitions on infra
  also use `defineActions` (`forge_deployment_action`). Names are enforced at
  registration: `<forge|cloud|storage|web|status>_<resource>_<verb>`.
- **`defineActions` merges every action's fields into one advertised schema**,
  each field labelled with the actions that use it, and parses the call with
  the chosen action's own schema. So the same concept must carry the same
  field name across a tool's actions (`id`, not `id` in one and `noteId` in
  another), and `action` is a reserved field.
- **The SDK must never validate arguments against a tool's schema.**
  `advertisedOnly` hands it the JSON Schema plus a pass-through validate. If
  the merged schema validated, a `.default()` or transform on one action's
  field would be applied to every action sharing the name before its own
  parse — `web_agent_tasks.update` sent create's `attachments: []` and
  `memoryMode`, which wipes stored values. `define.test.ts` pins this.
- **Upstream failures are `isError` results, never thrown.** `fromResponse`
  maps non-2xx to `{ status, error: <body> }`; success carries the body plus
  `httpStatus` in `structuredContent`. A tool that throws is a bug.
- **Input schemas come from `@repo/schemas`** wherever a route validates with
  one — spread `.shape` for objects, nest unions under a named field. Zod v4
  keeps `.shape` on refined objects, and the refinement is dropped by the
  spread: upstream re-validates, so that is fine.
- **List tools return summaries; get tools return whole rows.** A list of
  full rows overflows a tool result: `forge_targets_list` was 117 KB for 18
  targets, 65 KB of it commit bodies. `forge/summaries.ts` builds each summary
  schema from the canonical `@repo/schemas` shapes, so parsing strips the rest;
  a payload that stops matching falls back to cutting commit messages and logs
  a warning instead of failing the call.
- **Logs are bounded reads of live streams.** Build and runtime logs are SSE
  that never ends while a build runs or a container lives; `collectStream`
  reads for `maxMs` (default 4 s) or 512 KB and reports `complete`.
- **`forge_env_set` / `forge_env_unset` are GET → merge → PUT.** Safe only
  because a literal sent without `value` keeps the stored one; `GET .../env`
  never returns literal values. Nothing takes effect until `forge_env_apply`.
- **`cloud_run_command` parks a one-off a year out, triggers it, and polls.**
  The far date only keeps the one-off poller from racing the explicit
  trigger; the scheduler disables any non-cron task after its first run. The
  task row is kept for audit.
- **Unreachable by design, not oversight**: OAuth client management
  (`/api/oauth/*` refuses `oauth:` sessions, and this server *is* one), SMB
  credentials (human session only), the interactive terminal (WebSocket), the
  web LLM proxies (`chat`, `POST llm`, latex completion), `jobs/*`
  (`CRON_SECRET`), `authenticator/export`, and binary-only reads.
- **Tests build the client through the real HTTP handler**
  (`src/tools/harness.test-util.ts`): `recordingUpstream` records every call,
  `createClient(upstream, register?)` takes a registrar so a domain's test
  registers only its own tools. `tools/list` in the registry test is what
  proves every schema converts to JSON Schema.
- **`readOnly: true` on an action is an approval decision, not a label.**
  `defineActions` publishes each action's flags as
  `_meta["com.denizlg24/actions"]`, and the in-app agent runs a call without
  asking only when the chosen action is read-only. A read action left unmarked
  asks for approval every time; a write marked read-only never does. The
  tool-level `readOnlyHint` stays false for any tool that mixes the two.
- **`src/instructions.ts` is sent at initialize** and is the one place the
  domain workflows (read-before-replace, notes `categorize`, papers
  `resolve`, markets budget, …) are written down for every client.
  `instructions.test.ts` fails when it names a tool that does not exist.

## apps/desktop Architecture

### Stack
- Next.js 16 + React 19 + TypeScript (strict)
- Tauri desktop wrapper (uses `@tauri-apps/plugin-http` for fetch)
- Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react icons
- TanStack react-table for data tables
- Zustand for state, sonner for toasts
- Package manager: **bun** (never npm)

### Key Patterns

**API calls**: `denizApi` class in `lib/api-wrapper.ts`. Base URL comes from `NEXT_PUBLIC_DESKTOP_API_BASE_URL`, not a hardcoded host. The client is stateless: every request bears the OAuth session's access token from `lib/auth/session.ts` (`getAccessToken()`), refreshed on demand. Gate on `useAuthStore` (`status === "signed-in"`), never on a stored credential.
```ts
const api = useMemo(() => new denizApi(), []);

const result = await api.GET<T>({ endpoint: "..." });
if (!("code" in result)) { /* success */ }
```

**Page structure**: `"use client"` pages in `app/dashboard/{feature}/page.tsx`. Sub-components in `_components/`. Header bar pattern: icon + title + actions in `h-12 border-b` container.

**Loading**: Content-shaped `<Skeleton>` components matching final layout. See `ContactsLoadingSkeleton` or `UsageLoadingSkeleton` for reference.

**Data tables**: Inline `DataTable` component using TanStack react-table with `SortHeader` helper. Pattern in `llm-usage/page.tsx` and `contacts/page.tsx`.

**Error handling**: Union return `T | AuthError | ApiError`. Check `"code" in result` for errors. Optimistic updates with rollback on failure.

**Styling**: Minimalist/editorial. Small text (`text-xs`, `text-sm`). Muted foreground for secondary info. `tabular-nums` for numeric data. Badge variants for status. Line-variant tabs for filters.

### UI Components Available
All in `components/ui/`: accordion, alert, alert-dialog, avatar, badge, button, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu, dialog, drawer, dropdown-menu, form, input, label, popover, progress, scroll-area, select, separator, sheet, skeleton, slider, table, tabs, textarea, toggle, tooltip, sidebar, sonner (toasts).

### Navigation
Sidebar groups defined in `components/navigation/navigation-menu.tsx`. Routes registered in `context/user-context.tsx` `KNOWN_ROUTES` set.

### Type Definitions
Canonical API contract lives in `packages/schemas` (zod schemas; all TS types are `z.infer`): IContact, IEmail, IBlog, IProject, ICalendarEvent, ITimetableEntry, IWhiteboard, IKanbanBoard, IKanbanCard, IConversation, IResource, etc. Desktop's `lib/data-types.ts` is a re-export shim (plus desktop-only UI-state types). Change schemas FIRST; `turbo typecheck` surfaces both apps' breakages. Don't reintroduce local wire types or hand-written response interfaces.

## apps/web API Endpoints (consumed by apps/desktop)

### Session
- `GET /session` → `{ admin: true, via: "api-key" | "oauth" | "session" }` or 401 — who `requireAdmin` sees; the public blog asks it before showing moderation controls

### Contacts
- `GET /contacts` → `{ contacts: IContact[], stats: { pending, read, responded, archived, total } }`
- `GET /contacts/{ticketId}` → `IContact`
- `PATCH /contacts/{ticketId}` → `{ status }` or `{ emailSent }` body
- `DELETE /contacts/{ticketId}` → `{ success: true }`

### Email
- `GET /email-accounts` → `{ accounts: IEmailAccount[] }`
- `POST /email-accounts/{id}/sync` → sync inbox
- `GET /email-accounts/{id}/emails` → email list
- `GET /email-accounts/{accountId}/emails/{emailId}` → full email
- `GET /email-accounts/{accountId}/emails/{emailId}/attachments` → attachment list
- `POST /triage/bodies` → `{ triageIds: string[] }` → warms stored bodies for those rows

Bodies live in the `EmailBody` collection, written by `lib/email-body-store.ts`
and never on the `Email` document — `Email` is read in bulk by the triage
candidate scan and the inbox list, and Mongo returns whole documents. They are
stored on sync (which fetches `source`), on the triage run (which already
parsed them), and lazily on first open for anything older. Every write is
best-effort: a body that fails to store costs one slow render, and failing the
sync over it would stall `lastUid` and re-deliver the same messages.
Attachment *text* is deliberately not stored — it exists only to feed
extraction and is re-derived per run.

### Blog
- `GET /blogs` → `{ blogs: IBlog[] }`
- `POST /blogs` → `{ title, excerpt, content, tags?, media?, isActive? }` → `{ message, blog }`
- `GET /blogs/{id}` → `{ blog: IBlog }`
- `PATCH /blogs/{id}` → `{ toggleActive: true }` or full update body → `{ blog }`
- `DELETE /blogs/{id}` → `{ message }`

### Comments
- `GET /comments` → `{ comments: CommentWithBlogTitle[], stats: { total, pending, approved, deleted } }`
- `PATCH /comments/{id}` → `{ action: "approve" | "reject" }` → `{ success, comment }`
- `DELETE /comments/{id}` → `{ success, softDeleted }` (soft-deletes if has replies)

### Sub-resources (services tracked under a resource, e.g. mongodb/redis on pi-cloud)
- `GET /resources/{id}/sub-resources` → `{ subResources: (ISubResource & { uptime })[] }`
- `POST /resources/{id}/sub-resources` → `{ name, description?, isActive?, isPublic?, check }` where check is `{ type: "http", url, expectStatus?, expectJsonPath?, expectEquals? }` or `{ type: "tcp", host, port }` → `{ subResource }`
- `PATCH /resources/{id}/sub-resources/{subId}` → partial update → `{ subResource }`
- `DELETE /resources/{id}/sub-resources/{subId}` → `{ status: "deleted" }` (also deletes health logs)
- Checks run from the backend in the health-check cron (`runAllSubResourceChecks` in `lib/resource-agent.ts`); logs share `HealthCheckLog` keyed by sub-resource id; public `/api/public/resource-status` nests `subResources` per parent

### Forge environments and branch rules

A deploy target has three kinds of slot, and `deployments.kind` names which:
`production`, `environment` (a named custom environment such as staging) and
`preview`. `resolveBranchRoute` in `packages/cloud-core/src/deploy/environments.ts`
owns the whole branch-to-slot decision — production branch first and
unconditionally, then the highest-priority matching branch rule, then a preview.

- **`kind === "production"` almost never means what it used to.** The two places
  that genuinely mean production are custom domains, which only production
  carries, and promote, which only production is the target of. Everywhere else
  — routing, DNS GC, capacity, apply-env ordering, the preview auth gate — the
  question is stable-vs-ephemeral, and `isStableDeploymentKind` is that test.
- **An environment owns a hostname, not a domain row.** `deploy_domains` stays
  production-only. An environment is reached at a generated
  `<slug>-<env>-<random>.<zone>` stored on its own row, provisioned once at
  creation. That is what keeps promoting to production a real operation.
- **A capacity slot is `(target, kind, environment)`.** Each environment is
  charged the host's memory continuously, exactly like production — that is the
  real cost of adding one on a Pi. `supersedeOlderDeployments` keys on the same
  triple: without the environment, staging going ready supersedes the live `qa`
  container.
- **The `environment` env-var scope names one environment**, through
  `environmentId`. A staging deployment resolves `all` plus its own rows and
  never production's — inheriting them would hand staging the live database.
  The same reasoning maps `kind: "environment"` onto the *preview* side of a
  resource connection's scope.
- **A custom environment is gated like a preview, not like production.** Only
  production is public; `authorizePreviewRequest` tests `kind === "production"`.
- **Adding an enum value and using it need two migrations.** Postgres allows
  `ALTER TYPE ... ADD VALUE` in a transaction but refuses to let the new value
  be used in the same one, which is why `0037` holds only the two `ADD VALUE`
  statements and `0038` holds everything that compares against `'environment'`.
- **A manual deploy no longer chooses its kind.** `POST /targets/:id/deployments`
  derives it from the branch, so deploying the `staging` branch by hand lands in
  staging. The `kind` field on the input is accepted and ignored.

### Finance budgeting (envelopes, alerts, coach)

- `GET /finance/budget` → the whole tab: envelope definitions, per-envelope
  status, unbudgeted spend, monthly totals, open alerts, open suggestions
- `GET|POST /finance/envelopes`, `PATCH|DELETE /finance/envelopes/{id}`
- `POST /finance/envelopes/{id}/contributions`, `DELETE .../{contributionId}`
- `GET|POST /finance/budget/alerts` (list | re-evaluate now),
  `PATCH /finance/budget/alerts/{id}` → acknowledge | reopen | resolve
- `GET|POST /finance/budget/suggestions` (list | regenerate),
  `PATCH /finance/budget/suggestions/{id}` → apply | dismiss. **422, not 400**,
  when a well-formed apply is refused by the state of the budget
- `GET /finance/budget/drafts` → starter limits from history, no model involved

Things worth knowing before touching this:

- **`lib/finance/fetch-budget.ts` is the provider call budget, not money.** It
  was `budget.ts` until budgeting arrived and the collision became a trap.
  Money budgeting is `envelope-math.ts` (pure arithmetic), `envelopes.ts`
  (persistence), `budget-overview.ts` (snapshot), `budget-alerts.ts`,
  `budget-coach.ts`, and `budget.ts` assembles the response.
- **A category belongs to at most one active envelope.** Otherwise the same
  transaction is charged to two plans and both read as under control while the
  money was spent once. `assertEnvelopeCategoriesFree` enforces it, including
  the single claim on uncategorized rows; Mongo cannot express it as an index.
- **Envelope spend is net of refunds.** A returned purchase did not cost
  anything, and counting the charge without the credit poisons the limit a
  little more every month.
- **Rollover is recomputed from the ledger, never stored.** A bank row landing
  late, or a recategorization, changes what an earlier period actually spent —
  a stored balance would keep asserting the old answer forever. The walk-back
  is floored at the envelope's `startDate` and capped at 24 periods.
- **`surplus` absorbs an overspend, `both` carries it.** That is the whole
  difference, and it is why `none` is the default: one bad month under `both`
  shrinks every month after it until someone intervenes.
- **A sinking fund's contributions are recorded, not observed.** Setting money
  aside is not a bank transaction, so nothing can infer it. Spend in the fund's
  categories draws it back down, which is what makes buying the thing you saved
  for show up correctly.
- **Totals are stated per calendar month, envelopes on their own cadence.**
  Adding a weekly limit to a yearly one is meaningless, so `plannedMinor` is
  the monthly equivalent of every limit plus this month's required sinking
  contributions — which is what makes it comparable to `incomeMinor`.
- **Alerts are derived and idempotent.** Each carries a `key` stable for
  (kind, envelope, period); re-running updates instead of duplicating, and
  anything not re-derived is resolved. So an open alert is currently true.
  Acknowledging records the severity at the time, so a worsening condition
  reopens it — acknowledging "projected to overspend" must not silence
  "actually overspent".
- **Two detectors read `ledger.allRows`, not `ledger.rows`.**
  `deduplicateLinkedLedger` drops `missed` rows and the projection half of a
  projection↔bank match, which is right for spend and fatal for the two alerts
  that are *about* the projection — income that never landed, and a fixed
  subscription now charging more than its rule says. Both silently found
  nothing until they were moved.
- **The coach model never sees the ledger and never does arithmetic.** It gets
  precomputed envelope status, per-category medians and open alerts, in major
  units, and every amount it proposes must be one it was given. A suggestion
  naming an envelope or category that does not exist is dropped rather than
  rendered as a button that fails when pressed.
- **Every suggestion is applicable or explicitly `advice`.** There is no third
  kind where "apply" quietly does nothing. `reallocate` converts the amount
  between the two envelopes' cadences so the annual sum is preserved.
- **Nothing may sum `amountMinor` across rows of different currencies.** A
  recurring rule, an envelope limit and a ledger row each carry their own, and
  a DKK rule was being added straight into the euro "Monthly out" as though
  100 DKK were €100. Totals are converted server-side where the dated FX
  snapshots are, and anything with no applicable rate is reported under its own
  currency rather than folded in at par — `computeRecurringCommitment` and
  `loadBudgetLedger` both return an `unconvertedByCurrency` for exactly that.
- **An envelope is always in the base currency.** Its spend is measured from
  base-converted ledger rows, so a limit in any other unit compares two
  different things. The input schema has no currency field, the sheet shows the
  base rather than offering a choice, and `rebaseEnvelope` converts any older
  row left behind by a change to the base setting.
- **The alert pass runs at the end of `runFinanceCron` and cannot fail it.**
  The syncs already succeeded by then, and the next run re-derives the same
  alerts from the same ledger. As with markets, nothing in this repo drives
  that cron.

### Markets orders and margin
- `GET /markets/portfolios/{id}/orders` → `{ orders: Order[] }`; repeatable `?status=` narrows to the live book
- `POST /markets/portfolios/{id}/orders` → `OrderInput` → `{ orders }` (the entry plus any bracket legs). **422, not 400**, when the order is well-formed but refused — no buying power, no position to reduce, shorting off
- `PATCH /markets/portfolios/{id}/orders/{orderId}` → price, size and TIF only; side, type and symbol are not amendable
- `DELETE /markets/portfolios/{id}/orders/{orderId}` → cancels, and cancels any pending bracket legs beneath it

Things worth knowing before touching this:

- **Positions are signed and the invariant is `costBasis === avgCost * quantity`.** A short is a negative quantity with a negative basis, which is what makes `marketValue - costBasis` the unrealised PnL of either side with no branch. Break it and every metric silently changes meaning.
- **Shorting is opt-in per portfolio.** With `allowShorts` off, `applyTrade` clamps a sell to what is held exactly as it did before orders existed, so old portfolios replay unchanged.
- **Fills are simulated, never brokered.** `runOrderEngine` books them on the markets cron, so fill latency is the cron interval. Nothing hits `/api/jobs/markets` from inside this repo — the scheduler is external, and if it is not running, no order ever fills.
- **The trigger check reads the bar range, not just the quote.** A price that dives through a stop and recovers between two cron runs is invisible to a quote-only check, which is precisely the case a stop exists for. The placement day is excluded from that range: a daily bar has no time of day, so including it would fill a 3pm stop against the same morning's low.
- **`syncPortfolioActions` owns only `dividend`, `drip` and `split`.** `LEDGER_SOURCES` — manual, deposits, withdrawals, order fills, borrow, liquidation — is what it must never delete. Keying the cleanup on "not owner-entered" wipes the entire automated book.
- **Borrow ids are deterministic** (`borrow:<ticker>:<date>`) and upserted on `actionKey`. Charging a day twice is the failure that matters, not missing one.
- **A margin call is reported, never acted on.** `computeMargin` returns the shortfall and the UI shows it; nothing auto-liquidates, so one stale quote cannot sell the book.
- **The equity curve runs to today, not to the last cached bar.** A daily bar for today does not exist until after the close, so a curve built from bars alone stops at the previous session while positions are already live — and a portfolio opened today has no curve at all. `performanceDates()` adds inception and today; today's point is priced from the live quote.
- **The intraday curve is observed, not reconstructed.** `MarketPortfolioValuePoint` records what the book was worth whenever something priced it against live quotes, bucketed to the minute and expiring after 30 days. Rebuilding it from intraday bars would cost one provider request per holding per minute against a 50/hour cap; `getPerformance` has already paid for the quotes. The series is therefore dense while something is watching and sparse otherwise, and carries no per-symbol breakdown — nothing prices a single holding minute by minute.

### Agent memory and agent tasks

- **A disagreement is not automatically a contradiction.** The formation model
  can only report that two statements disagree; `classifyTemporalConflict` in
  `lib/agent-memory/temporal-succession.ts` decides what that means. A statement
  observed later than an open-ended one supersedes it, two statements dated to
  the same instant contradict, and one describing an older state than what is
  stored is dropped as stale. Without this, every value that moves — a balance,
  a count, a role, a city — grows permanent contradiction links.
- **Undated statements need an hour of separation to count as succession.** One
  conversation disagreeing with itself is a contradiction, not a value moving.
  This is why the formation prompt pushes so hard on setting `temporal.validFrom`
  for anything that changes: a date makes the ordering explicit.
- **A less explicit statement never silently supersedes a more explicit one.**
  An inference that disagrees with something the owner stated stays a
  contradiction however much later it arrives.
- **`succession` is informational, not a review request.** It is in
  `INFORMATIONAL_REVIEW_FLAGS`, so it does not hold auto-promotion the way every
  other review flag does. Adding a flag there without that intent puts a review
  queue in front of ordinary memory formation.
- **`save_memory` writes through the candidate path, so embedding is automatic.**
  `writeRevision` enqueues the embedding job for any active revision. What the
  tool does not do is enqueue *formation* on its evidence row — the statement is
  already a finished memory, and extraction reading it back would re-derive it as
  a competing candidate.
- **Dedup happens on save, not later.** Shadow retrieval has usually just shown
  the agent the memory it is about to duplicate. A word-for-word restatement
  reinforces (evidence appended, confidence a quarter closer to 1, asymptotic);
  a restatement with a changed value supersedes; only a same-sitting
  disagreement is left as a contradiction.
- **`memoryMode` reaches tools through `ToolExecutionContext`.** An incognito
  turn must write nothing. A new memory-writing tool that ignores the context
  will happily write during incognito.
- **A task takes either `schedule` or `runAt`, never both.** They describe the
  same field — when it next fires. A spent one-off archives itself; the run stays
  in the run history.
- **Agent-scheduled tasks are ungated by decision.** Task runs execute write
  tools unattended with no approval step, so a task can schedule tasks with
  nobody in the loop. `origin` records who queued each one and the UI
  separates them; that visibility is the control, not a cap.
- **A task run is a transcript, persisted while it runs.** `AgentTaskRun.messages`
  is `AgentUIMessage[]` in the same shape as a conversation, written every ~2 s
  from `readUIMessageStream` snapshots and once more at the end, which is what
  lets the tasks page watch a run live by polling `GET /agent-tasks/runs/:id`.
  The overview list carries summaries only (`outputPreview`, `toolCallCount`);
  rows from before this carry the flat `toolCalls` audit instead, and
  `serializeAgentTaskRun` rebuilds those as tool parts so there is one renderer.
- **Nothing in this repo drives the task cron.** As with markets, the scheduler
  is external. If it is not running, no scheduled task ever fires.

### The in-app agent: AI SDK loop and connectors

Chat, background runs, scheduled tasks and the LaTeX agent all run through
`startAgentTurn` (`lib/agent/turn.ts`) → `streamAgentTurn` in `llm-service.ts`
(AI SDK v7 `streamText` over the Gateway) → a UI message stream. Its tools are
connector tools (MCP servers, `lib/connectors/`) plus a handful of built-ins
(`lib/agent/builtin-tools.ts`). Wire contract:
`docs/internal/plans/agent-connectors-refurbish.md`, "Client contract".

- **There is no step ceiling anywhere.** `streamAgentTurn` runs
  `stopWhen: () => false`, and `runToolLoop` (the single-shot Anthropic
  transport behind triage, formation and lessons) reads for as long as the
  model keeps asking; nothing carries a `maxRounds`. What that costs is
  lease-keeping: a job lease is six minutes, so `processAgentTaskJob` and
  `processBackgroundAgentJob` run inside `withMemoryJobHeartbeat`, which
  extends the job lease and the run's `executionLeaseExpiresAt` every two
  minutes. A `running` row is dead when its lease has lapsed, never because it
  is old — anything new that judges a run by `startedAt` will kill long runs.
- **The server owns the thread.** The client sends only the last message.
  A user message keeps only text and file parts; an assistant message is a
  continuation from which `lib/agent/merge.ts` copies approval decisions for
  approval ids the stored message is actually waiting on, and outputs for the
  three page tools — nothing else. That is what makes a forged approval or a
  rewritten tool input impossible without `experimental_toolApprovalSecret`.
- **Conversations store `UIMessage[]` (`format: "ui"`).** A row without
  `format` predates the loop and is Anthropic-shaped; `storedMessagesToUI`
  converts it on read, the next save rewrites it, and
  `bun run conversations:migrate` (dry-run unless `--apply`) settles the rest.
  Page context and recalled memory images are appended to the model messages
  only (`lib/agent/model-messages.ts`) and never stored.
- **Evidence is derived per part, with ids stable across saves.** One UI
  message spans every step of a turn and is re-saved as it grows, so
  `agentEvidenceUnits` maps it onto the old one-row-per-turn shape
  (`<id>:text:<index>`, `<id>:tool:<callId>`) and `saveConversationMessages`
  observes only units the previous save did not have. User message ids are the
  client's; converted legacy messages keep their event ids.
- **Approval is `lib/agent/approval.ts`, per call.** A connector call runs
  unasked only when the chosen action (or the tool) is read-only and the
  connector's policy is `reads-auto`; `always-ask` / `never-ask` override; YOLO
  runs everything. Built-in writes (`save_memory`) ask in interactive mode. An
  incognito turn denies every write to `web_agent_memory*` on the primary
  connector — the MCP server cannot see the turn's memory mode, so the policy
  is the only thing holding that line.
- **The primary connector is a seeded row, `slug: "denizlg24"`, `auth:
  "service"`.** Its URL and credentials come from the environment on every
  call (`WEB_MCP_OAUTH_CLIENT_ID/SECRET`, a `service` client with only the MCP
  resource; `MCP_CONNECTOR_URL`, which also sets the resource, and
  `MCP_CONNECTOR_ISSUER` point a dev web at the production server). Never put
  a production `OAUTH_RESOURCE_MCP` in the root `.env` for this: the local API
  and MCP read that one. Unset leaves it `unconfigured` and chat runs on the
  built-ins. Only its approval, enabled flag and disabled tools are editable.
- **Third-party connectors are `none`, `bearer` or `oauth`.** OAuth is the MCP
  flow through `@ai-sdk/mcp` `auth()` with `ConnectorOAuthProvider`: tokens,
  registered client and PKCE verifier are sealed with `IMAP_ENCRYPTION_KEY`;
  the pending `state` is stored only as a hash, and the public callback
  `/api/connectors/oauth/callback` finds the row by that hash while it is
  unexpired. Redirects stay at the SDK's `'error'` default so a server cannot
  bounce a bearer token to another host. A third party's `instructions` go
  into the prompt marked `data-not-instructions`; ours do not.
- **`tools/list` is cached on the connector for 30 minutes**, and a client is
  opened only when the model first calls one of its tools. Tool names are
  `<slug>__<tool>` (hashed past 64 characters). A connector result is cut at
  48 000 characters with a note telling the model to narrow the request.
  The client sends a schema's `x-mcp-header` arguments as `Mcp-Param-*`
  headers only for definitions it has itself listed, so the per-turn client is
  primed from the cache (`primeToolHeaderBindings`) before its first call —
  GitHub's servers refuse `owner`/`repo` calls without them, and a
  `callTool` on an unprimed client fails with "missing Mcp-Param-… header".
- **Web search and fetch are provider tools.** Anthropic models get
  Anthropic's `web_search` / `web_fetch`; anything else searches through the
  Gateway's Perplexity tool and has no fetch. "Think longer" is `effort: max`
  on adaptive-thinking models and `reasoning: "xhigh"` elsewhere.
- **The LaTeX agent proposes edits as tool calls.** `propose_change` validates
  one change against the loaded project and returns `{ proposal, status }`;
  the proposal id is the tool call id, and `PATCH …/agent` records the user's
  decision on that output. Nothing the agent does writes a file.

### Authenticator
- `GET /authenticator` → `{ accounts: IAuthenticatorAccount[] }` (no secrets)
- `GET /authenticator/codes` → `{ codes: IAuthenticatorCode[] }` — server-computed, used by the admin and desktop UIs
- `GET /authenticator/export` → `{ accounts: IAuthenticatorExportAccount[], exportedAt }` — **the only route that returns decrypted base32 secrets.** It exists so `apps/authenticator-extension` can hold an offline vault; a leaked API key here costs every secret, not one code. Do not call it from the web or desktop UIs, and do not persist its response anywhere unencrypted.
- `POST /authenticator` → `{ label, issuer, accountName, secret, algorithm?, digits?, period? }` → `{ account }`
- `PATCH /authenticator/{id}` → label/issuer/accountName only; a secret is never updated in place
- `DELETE /authenticator/{id}` → `{ success: true }`

### Voice notes
- `GET /voice-notes` → summaries (no transcript body); filters `q`, `status`/`source`/`tag`/`groupId`/`contextId` (repeatable, any-of), `context=any|none`, `linked`, `from`/`to` on `recordedAt`, `sort`, `limit`/`offset` → `{ voiceNotes, total, totalDurationMs }`
- `GET /voice-notes/facets`, `GET /voice-notes/{id}` (transcript + segments), `PATCH /voice-notes/{id}` → `{ title?, tags?, context?: {kind,id} | null | "auto" }`, `GET /voice-notes/{id}/context-candidates`
- Design: `docs/internal/plans/023-voice-notes-overhaul.md`

- **Any `/api/admin` body over `proxyClientMaxBodySize` is silently truncated.**
  `proxy.ts` matches `/api/admin/:path*`, and Next clones a proxied body only
  up to that limit before handing the rest of the request to the route — which
  then fails to parse a multipart it cannot see the end of. It is `260mb` in
  `next.config.ts` for voice notes; at the 10 MB default every recording over
  ~27 minutes was a 500 and the recorder dropped the audio.
- **`gpt-transcribe` answers a long request with `500 Audio file processing
  failed`.** Every recording ≥ 39 min failed and every one ≤ 19 min worked, at
  any size under 25 MB. Voice notes are cut into 300 s pieces with the static
  ffmpeg in the web image (`FFMPEG_PATH`) and transcribed in order, each with
  the previous text's tail as `prompt`; every piece lands in
  `transcription.segments` as it finishes, so a retry resumes. Dictation
  (`/voice-notes/transcribe`) is still one request and still has the ceiling.
- **The desktop web view ignores `audioBitsPerSecond`.** It asks for 24 kbps
  and writes ~50 kbps, so size limits reached twice as early as their comment
  said.
- **`context` is derived once, at save.** A timed calendar event overlapping
  the recording wins, else the active timetable slot for that local weekday;
  overlap must be ≥ min(10 min, half the recording). `contextSource: "manual"`
  (set or cleared by hand) is never re-derived; an upload with no `recordedAt`
  is never linked. Groups are not stored — they are read through linked notes.

### Upload
- `POST /upload` → FormData with "file" field → `{ url, hash }`. Stores to the self-hosted cloud S3 via `uploadFileToStorage(file, "image")`, where `"image"` is the bucket name, not a type filter — the route enforces no type or size limit. Pinata is gone — the spreadsheets routes read and write the same self-hosted storage, and only their `pinata*` column names survive.

### CV
- `GET /cv` → `{ cv: ICvFile | null, project: LatexProject | null }` (metadata and LaTeX source are stored on the AppSettings singleton)
- `GET /cv/file` → PDF bytes proxied from storage (admin preview renders these via react-pdf; webviews can't embed remote PDFs natively)
- `PUT /cv` → validates and saves a multi-file LaTeX project draft without publishing it
- `POST /cv/compile` → validates and compiles the LaTeX project with sandboxed Tectonic, uploads the generated PDF to the storage `file` bucket, persists source and metadata, and revalidates `/`
- `POST /cv` remains as the legacy PDF upload endpoint; `POST /cv/publish` revalidates the public page separately
- The reusable editor workspace lives in `packages/latex-editor`; it supports files, folders, tabs, binary assets, a compile log, and a PDF preview slot
- Public homepage resume button reads the stored URL via `lib/cv.ts` `getCvUrl()`, falling back to the bundled `/assets/DenizGunesCV2026.pdf`; shared admin UI is `packages/admin/src/cv/cv-page.tsx`

### LLM Usage
- `GET /llm/usage` → usage stats, breakdowns, recent requests
- `GET /llm/models` → `{ models: LlmCatalogModel[], stale, fetchedAt }` — Vercel AI Gateway language-model catalog (fully qualified ids like `anthropic/claude-haiku-4.5`, capability tags, context/output limits); filters: `?creator=` and repeatable `?requiredCapability=`; 503 when the catalog is cold
- All server LLM traffic goes through `apps/web/lib/llm-service.ts` (Vercel AI Gateway; `AI_GATEWAY_API_KEY`). Never import a provider SDK or build provider URLs in app code — add operations to the service instead. Model ids are fully qualified Gateway ids; legacy dashed ids resolve via the service's alias map. The agent loop's AI SDK models and provider tools come from `lib/llm-transports/ai-gateway.ts`; single-shot operations (triage, formation, classification) still use the Anthropic-compatible transport.
- **Two documented exceptions**, both shaped the same way: the provider call
  lives in a single `lib/llm-transports/*` module, app code still only calls
  `llm-service`, and because neither model is in the Gateway catalog its pricing
  is a hand-maintained constant in `llm-service.ts` rather than resolved live.
  A stale rate shows up as wrong spend in usage reporting, not as a failure.
  - `embedMultimodal()` → Cohere via `cohere-embeddings.ts` (`COHERE_API_KEY`).
    The Gateway's `/v1/embeddings` validates the OpenAI-shaped `input` field and
    drops Cohere's `inputs`/`images`, so multimodal embedding is unreachable
    through it — every Gateway embedding model reports text-only input. See
    `docs/internal/plans/attachment-memory.md`.
  - `transcribeAudio()` → OpenAI via `openai-transcription.ts`
    (`OPENAI_API_KEY`). The Gateway exposes no speech-to-text route at all and
    its catalog lists only language and embedding models. Model set by
    `VOICE_TRANSCRIPTION_MODEL`. OpenAI bills transcription two ways — newer
    models per token with audio and text metered separately, `whisper-1` per
    minute — and `OPENAI_TRANSCRIPTION_PRICING` covers both; an id missing from
    it still transcribes but logs $0 and warns.
- Do not widen either exception without the same kind of evidence: an operation
  the Gateway genuinely cannot carry, not one that is merely inconvenient.

## Porting Features from apps/web

When porting features to apps/desktop:
1. Use apps/desktop's existing patterns (api wrapper, loading skeletons, page structure)
2. Keep minimalist/editorial styling — small text, muted colors, clean spacing
3. Improve over apps/web's design (better skeletons, sheets instead of page navigations, relative dates)
4. Types already exist in `packages/schemas` (re-exported via desktop `lib/data-types.ts`) — check before adding new ones
5. Navigation entry already exists in sidebar for most features — verify in `KNOWN_ROUTES`

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
