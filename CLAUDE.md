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

Every directory below with domain rules has its own `AGENTS.md`; the table at
the end of this file maps areas to them.

Web, desktop and the cloud:

- `apps/web/` — Next.js: the public site, the `/admin` dashboard and the API
  every other client consumes (Forge, MongoDB).
- `apps/desktop/` — Tauri + Next.js static export; route shims over
  `packages/admin`, signed in as an OAuth public client.
- `apps/api/` — Hono + Bun API for the self-hosted cloud. Runs on the Pi in
  Docker under compose, not through Forge.
- `apps/cloud/` — Next.js admin panel for the cloud (Forge).
- `apps/forge/` — Next.js Forge dashboard; Forge deploys it from its own Dockerfile.
- `apps/deploy-agent/` — the Forge host agent (builds, Caddy edge, DR, reboots).
- `apps/storage/` — Next.js file browser (Forge), family-facing.
- `apps/storage-metadata/` — compiled Bun host service owning the storage
  namespace metadata on the Pi.
- `apps/terminal/` — compiled Bun web-terminal daemon on the Pi host (systemd).
- `apps/auth/` — Next.js sign-in, consent and OAuth client management
  (Forge, `auth.denizlg24.com`). UI only: talks to the API from the browser,
  holds no secrets.
- `apps/mcp/` — Hono + Bun MCP server for the whole infrastructure (Forge,
  `mcp.denizlg24.com/mcp`), MCP TypeScript SDK v2, an OAuth resource server.
- `apps/browser/` — Hono + Bun MCP server giving the in-app agent one headful
  Chrome (Forge, `browser.denizlg24.com/mcp`); no workspace dependencies on purpose.
- `apps/sandbox/` — conversation-scoped JS/TS/Python execution for the agent.
- `apps/agent-runner/` — compiled Bun daemon on the Forge host (systemd, not a
  deployment) running sprint slots: headless Claude Code in gVisor.
- `apps/agent-canvas/` — local Tauri app hosting Codex and Claude Code PTYs.
- `apps/status/` — Next.js public status page (Forge, project `status`; env in
  `.env.status`). Its own Mongo on Atlas.
- `apps/markets-relay/` — Yahoo Finance / FRED relay behind web's Markets.
- `apps/stockwatcher/` — Next.js market and research workspace (Forge,
  project `stockwatcher`, `stockwatcher.denizlg24.com`); signs people in
  through a deniz auth tenant client, so it is not single-user. Postgres via
  a Forge binding; no workspace dependencies.
- `apps/email-classifier/` — classical email classifier used by triage.
- `apps/ssh-server/` — Go server behind `ssh me.denizlg24.com`.
- `apps/envoy/` — Next.js site and Hono/Prisma API for the Envoy CLI (Forge);
  wire contracts in `packages/schemas/src/envoy`.
- `apps/envoy-cli/` — Rust `envy` CLI; this monorepo owns its releases
  (`envoy-v*`).
- `apps/authenticator-extension/` — Vite + React MV3 extension (Chrome,
  Firefox) with an offline TOTP vault synced with `/api/admin/authenticator`;
  `ext-v*` releases on a version change on `main`.

Macros:

- `apps/macros/` — the Macros API, marketing site, auth-email landings
  (`/register/*`), public recipes (`/recipes`) and web recipe editor
  (`/kitchen`). The one multi-user app.
- `apps/macros-mobile/` — Expo SDK 57 iOS app (App Store) and sideloaded
  Android APK; not deployed by Forge.
- `apps/macros-admin/` — owner-only moderation console for shared foods
  (Forge, `macros-admin.denizlg24.com`).
- `apps/macros-vision/` — private FastAPI label OCR / food-photo classifier.
- `apps/nutrition/` — Bun + Elysia food catalogue API (Forge,
  `nutrition.denizlg24.com`): USDA, national tables and OpenFoodFacts in one
  Postgres, ranked by Meilisearch.

Owner-only native apps:

- `apps/hours-mobile/`, `apps/voice-mobile/`, `apps/location-mobile/`,
  `apps/dashboard-mobile/` — Expo SDK 57 iPhone apps, unpublished, installed
  from the Mac with `bun run ios:device`, built unsigned by `personal-ios.yml`.
- `apps/tally-macos/` — SwiftUI menu-bar app: Claude seat usage and
  switching, Codex limits, LLM spend. `tally-v*` releases, never "latest".
- `apps/stream/`, `apps/stream-mobile/`, `apps/stream-desktop/` — the family
  film catalogue (web/TV, phone, desktop).
- `apps/tv-launcher/` — the living-room Google TV's launcher (Kotlin),
  sideloaded over adb; not a workspace.

Packages:

- `packages/schemas/` — the wire contract (zod) for everything.
- `packages/utils/` — pure shared logic (workspace ops/markdown/views, payroll,
  sprints, agent streams, changelog parser, …).
- `packages/admin/` — every admin feature's UI, shared by web and desktop.
- `packages/ui/` — the design system (`packages/ui/DESIGN.md`).
- `packages/cloud-core/` — Pi-side cloud logic: drizzle schema, storage/S3,
  projects, ops, sync, deploy, middleware.
- `packages/cloud-ui/`, `packages/cloud-auth-client/` — shared cloud client
  pieces; the latter holds the redirect allowlist (`./redirect`) and the
  access-token verifier every resource server uses (`./resource`).
- `packages/auth-sdk/` — `@denizlg24/auth`, the public SDK for apps signing
  in with deniz auth. Publishable: runtime dependency `jose` only, no
  `@repo/*` imports; `release-auth-sdk.yml` behind `npm-release`.
- `packages/auth-ui/` — the auth app's flow components.
- `packages/native-ui/`, `packages/native-auth/`, `packages/expo-ios-targets/`
  — UI primitives, deniz auth sign-in (PKCE via ASWebAuthenticationSession)
  and config plugins (widgets, App Intents, iOS 27 scene life cycle) for the
  owner's iPhone apps. Macros keeps its own copies.
- `packages/macros-core/` — pure Macros domain logic shared by web and iOS.
- `packages/latex-editor/`, `packages/markets/`, `packages/stream-player/`,
  `packages/tts/`, `packages/whiteboard-render/`, `packages/typescript-config/`.
- `docs/internal/` — plans, architecture notes, runbooks. Gitignored: on the
  owner's machine only.
- `_archive/` — the original standalone repos with history (gitignored,
  read-only rollback material).

"Smoke test" is banned vocabulary here — in code, scripts, env vars, workflows
and docs. A harness against a running service is an `e2e`
(`apps/api/scripts/*-e2e.ts`); a check on a built image is `verify`.

Tasks run through turbo: `bunx turbo build | typecheck | test | dev [--filter=web|desktop|api|cloud|storage|envoy|auth|mcp]`; `bun run format-and-lint` at root. `bun run dev:auth` runs api, auth (3008) and mcp (3009) together.

### Changelogs and version bumps

- `bun run bump:desktop <patch|minor|major>` and `bun run bump:macros …` bump
  the version that triggers each app's release and open a dated
  `## <version>` entry in its `CHANGELOG.md` (`apps/desktop`,
  `apps/macros-mobile`); an entry written beforehand is kept.
- Both files are parsed by `@repo/utils/changelog` (a Markdown subset; types
  in `@repo/schemas` `changelog`). Desktop reads its own at build into
  Settings → Release notes; Macros' site serves its own at `/changelog` and
  `/api/changelog`, which the app's Settings → What's new fetches.
- The desktop GitHub release body is `scripts/ci/release-notes.ts`: the
  changelog entry plus the first-parent merges since the previous `v*` tag
  that touched the desktop's paths — never `--generate-notes`, which lists
  every PR in the monorepo. A path the desktop starts bundling belongs in the
  workflow's `--paths`.
- `apps/macros-mobile/scripts/changelog.test.ts` fails when the app's version
  has no changelog entry.

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
| `nutrition.denizlg24.com` | Forge, `apps/nutrition` — DB, Redis and Meilisearch on the Pi |
| `macros-admin.denizlg24.com` | Forge, `apps/macros-admin` — not `admin.macros.…`: Cloudflare's free edge certificate covers one subdomain level only |
| `browser.denizlg24.com` | Forge, `apps/browser` — memory reservation matters: one Chromium plus ~100 MB per open context |
| `search.denizlg24.com` | Pi, Meilisearch published on loopback for legacy consumers |
| Postgres 5433 / Mongo 27018 / Redis 6380 | Pi, published publicly for dependent projects |
| `forge-redis-<instance>` | Forge host, `forge-redis@<instance>.service` on the `forge-apps` network, not published. Shortn's cache and durable Redis (prod + staging) |

Deploys: push to `main` → CI builds `ghcr.io/denizlg24/deniz-cloud-api` (arm64) →
`docker compose -p deniz-cloud --env-file .env.pi -f docker-compose.pi.yml --profile tools up -d`
from `/opt/deniz-cloud/infra/compose` on the Pi. Every Next.js app is built and
run by Forge from its own Dockerfile. Reach the Pi with `tailscale ssh denizlg24@pi-cloud` (no password).

Nothing that runs here sits behind a PaaS request limit — there is no 4.5 MB or
100 MB body cap on an upload route, and no platform-imposed function timeout.
What *is* finite is the host's memory, so a route that buffers a whole upload
competes with everything else on the box. `maxDuration` on a route is a Next.js
hint, not a platform ceiling.

### Forge builds

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
- **Web's type graph outgrew node's default 4 GB heap.** A cold `tsc` over
  `apps/web` builds about a million types (the mongoose models dominate) and
  peaks right at 4 GB, so CI's typecheck and its node-run `next build` died
  with `heap out of memory`. Both web scripts set
  `--max-old-space-size=6144`; the ubuntu runners have 16 GB. Local runs
  looked fine only because `incremental` reuses the build info.
- **`bunx` is not covered by the Bun version pin unless it is placed too.**
  `injectBunVersion` copies `bun` into `/usr/local/forge-bin`; `bunx` in
  `oven/bun` is an absolute symlink to a path the nixpacks image lacks, so it
  cannot be copied and is symlinked instead. Every Turborepo target here opens
  its build command with `bunx`, so without that link the build silently runs
  nix's Bun 1.3.0 while the log says the pinned version was copied in. Read the
  version off the crash report or `bun --version` in the build, never off that
  log line.

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
| MCP server → `apps/status` | `https://status.denizlg24.com` | bearer on `/api/admin/*` |
| `apps/status` admin | `https://api.denizlg24.com` | confidential client, authorization code (`DENIZ_AUTH_CLIENT_ID/SECRET`); the token gates `/admin` and is forwarded to the API |

- **Forge's edge strips every `deniz-cloud.*` cookie before a request reaches a
  deployment** (`apps/deploy-agent/src/caddy.ts`), on purpose — no deployed
  app may hold the cloud credential. So no Forge-hosted app can check the
  cloud session server-side. cloud/forge/storage/auth only use it from the
  browser against the API; web and mcp get server-verifiable identity from
  access tokens. status signs its admin in through deniz auth like
  macros-admin, with a token for the API that `cloudRequest` forwards.
- **Every first-party token is a superuser token, enforced at issuance and
  every refresh.** `customAccessTokenClaims` in `apps/api/src/auth/better-auth.ts`
  throws for anyone but an active, TOTP-enrolled, unbanned, `cloud`-realm
  superuser, and a Hono gate refuses non-superuser sessions at
  authorize/consent/continue. User tokens carry `superuser: true`; machine
  tokens carry `scope superuser` and `owner`, the superuser who created the
  service client. `isSuperuserToken` in `@repo/cloud-auth-client/resource` is
  the one test resource servers apply. Tenant clients
  (someone else's app signing people in with deniz auth) are the exception:
  their tokens never carry `superuser` — see `apps/api/AGENTS.md`.
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
  database without 0044. `apps/macros` was pinned to 1.7.1 for this reason
  and no longer is: its `account` table has no `issuer` column at all — it
  never ran 0040 and uses no plugin that adds one — so the mismatch cannot
  arise. 1.7.5 was booted against the live `proj_macros` database before the
  pin came off (adapter initialises, sessions and accounts read back).
- **Keep web's Mongo `user` collection.** Sign-in no longer uses it, but agent
  memory reads its one document as the owner's identity and its `_id` as the
  owner node's id. `session`, `account` and `verification` are dead.

Rollout order for anything touching this: apply cloud-core migrations (0043
OAuth tables, 0044 issuer, 0045 remember-me, 0050 passkeys, 0051 passkey offer,
0053 realms and tenants) → roll the API (manual approval) → deploy auth and
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

## Shared admin UI (web and desktop)

Every admin feature is one component in `packages/admin`, mounted by thin
route shims in `apps/web/app/admin/dashboard/*` and
`apps/desktop/app/dashboard/*` under an `AdminProvider` (client, platform
bridge, routes, slots). Wire types live in `packages/schemas` — change the
schema first and let `turbo typecheck` surface both apps. Details, including
the workspace editor and routing rules, in `packages/admin/AGENTS.md`.

## Where the rest lives

Domain detail sits next to its code, in each directory's `AGENTS.md`
(loaded through a `CLAUDE.md` that imports it). Read the one for the area
you are touching before changing it:

| Area | File |
|---|---|
| Pi API operations, cutover scripts, auth internals (tenants, realms, remember-me, passkeys, trust device, sign-in links, device codes) | `apps/api/AGENTS.md` |
| Storage, tiering, thumbnails, S3, file serving, Forge environments/branch rules | `packages/cloud-core/AGENTS.md` |
| Forge host: DR backups, reboots, watchdog, CPU weights, stateful host units | `apps/deploy-agent/AGENTS.md` |
| Host metadata service release/restarts | `apps/storage-metadata/AGENTS.md` |
| Web terminal daemon | `apps/terminal/AGENTS.md` |
| web's admin API: workspace, surfaces, finance, hours, markets, brokerage, study, agent memory, the in-app agent, voice notes, LLM usage, Jev | `apps/web/AGENTS.md` |
| Shared admin UI for web and desktop | `packages/admin/AGENTS.md` |
| MCP server tools and catalog | `apps/mcp/AGENTS.md` |
| The agent's browser | `apps/browser/AGENTS.md` |
| Sprint agent | `apps/agent-runner/AGENTS.md` |
| Status page and incident triage | `apps/status/AGENTS.md` |
| Macros API and moderation · iPhone/Android app | `apps/macros/AGENTS.md` · `apps/macros-mobile/AGENTS.md` |
| Nutrition API | `apps/nutrition/AGENTS.md` |
| Hours, Voice, Dashboard, Location for iPhone | `apps/{hours,voice,dashboard,location}-mobile/AGENTS.md` |
| Envoy CLI releases | `apps/envoy-cli/AGENTS.md` |
| Stream, Stockwatcher, Tally, TV launcher | their own `AGENTS.md` |
