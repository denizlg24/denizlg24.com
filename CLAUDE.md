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

## Structure

Turborepo monorepo (bun workspaces, single root `bun.lock`, Biome lint/format at root).

- `apps/web/` (formerly `portfolio-2026/`) — Next.js admin dashboard + API (backend). Manages portfolio content, contacts, blog, projects, email, calendar, etc. Uses MongoDB, shadcn/ui, Tailwind.
- `apps/desktop/` (formerly `denizlg24-app/`) — Tauri + Next.js desktop app (client). Consumes the web app's API. Minimalist/editorial design.
- `apps/api/` — Hono + Bun API for the self-hosted cloud. Runs on the Pi, not Vercel.
- `apps/cloud/` — Next.js admin panel for the cloud (Vercel).
- `apps/storage/` — Next.js file browser (Vercel).
- `apps/envoy/` — Next.js public site and Hono/Prisma API for the Envoy CLI
  (Vercel). Uses project-scoped denizlg24 cloud S3 credentials; canonical wire
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
- `packages/cloud-core/` — Pi-side cloud logic: drizzle schema, storage/S3, projects, ops, sync, middleware.
- `packages/cloud-ui/`, `packages/cloud-auth-client/` — shared client pieces for the two Vercel cloud apps.
- `packages/typescript-config/` — shared tsconfig presets.
- `docs/internal/` — plans, architecture notes and deployment runbooks. Gitignored: present on the owner's machine, not in a fresh clone.
- `_archive/` — the original standalone repos with full git history (gitignored; read-only rollback material).

Tasks run through turbo: `bunx turbo build | typecheck | test | dev [--filter=web|desktop|api|cloud|storage|envoy]`; `bun run format-and-lint` at root.

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

## The self-hosted cloud (apps/api, apps/cloud, apps/storage, apps/terminal)

Cut over to production on 2026-07-25, replacing the old standalone `deniz-cloud`
repo. That repo is gone: submodule removed, containers and images deleted, the
directory archived to the Pi's `BACKUP_DIR` as `decommission-*/deniz-cloud-repo.tar.gz`.

### Where things run

| Surface | Host |
|---|---|
| `api.denizlg24.com` | Pi, `apps/api` in Docker behind a Cloudflare tunnel. Serves `/api/*`, `/v2` (S3), `/healthz` |
| `cloud.denizlg24.com` | Vercel, `apps/cloud` |
| `storage.denizlg24.com` | Vercel, `apps/storage` |
| `search.denizlg24.com` | Pi, Meilisearch published on loopback for legacy consumers |
| Postgres 5433 / Mongo 27018 / Redis 6380 | Pi, published publicly for dependent projects |

Deploys: push to `main` → CI builds `ghcr.io/denizlg24/deniz-cloud-api` (arm64) →
`docker compose -p deniz-cloud --env-file .env.pi -f docker-compose.pi.yml --profile tools up -d`
from `/opt/deniz-cloud/infra/compose` on the Pi. Vercel deploys itself.
Reach the Pi with `tailscale ssh denizlg24@pi-cloud` (no password).

### Things that will bite you

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
  `/usr/local/bin/cloud-terminal` — CI does not deploy it; rebuild and copy manually.
- **`apps/storage-metadata` is the same deal, and it is easier to forget.** It is a
  compiled binary at `/usr/local/bin/cloud-storage-metadata` under
  `deniz-cloud-storage-metadata.service`; `bun run build:pi` then copy and
  `systemctl restart`. Pushing to `main` rebuilds only the API container, so a fix
  in this app is not live until the binary is replaced by hand — and because the
  API keeps working against the old service, nothing reports that it wasn't.
  Deploy it *before* pushing code that calls a new socket op. Two adjacent traps:
  piping the binary through a shell `cat` can corrupt it (use `dd`), and the
  `Release cloud API` workflow's **Deploy to Pi job waits on a manual environment
  approval**, so a green build does not mean the API rolled out.
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

### Migration and cutover scripts

`apps/api/scripts/` (`cutover:*` in its package.json) share one harness in
`scripts/lib/runner.ts`: dry-run by default, `--execute` required to write,
`--dry-run` and `--execute` together is an error, JSONL audit log via `--log`, one
JSON summary line on stdout, and marker rows in `auth_verification` enforcing
order (schema → users → s3). Full reference in `docs/internal/cutover/`.

## apps/desktop Architecture

### Stack
- Next.js 16 + React 19 + TypeScript (strict)
- Tauri desktop wrapper (uses `@tauri-apps/plugin-http` for fetch)
- Tailwind CSS v4 + shadcn/ui (Radix primitives) + lucide-react icons
- TanStack react-table for data tables
- Zustand for state, sonner for toasts
- Package manager: **bun** (never npm)

### Key Patterns

**API calls**: `denizApi` class in `lib/api-wrapper.ts`. Base URL comes from `NEXT_PUBLIC_DESKTOP_API_BASE_URL`, not a hardcoded host. Auth via Bearer token.
```ts
const api = useMemo(() => {
  if (loadingSettings) return null;
  return new denizApi(settings.apiKey);
}, [settings, loadingSettings]);

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
  tools unattended (`lib/agent-tasks/execution.ts` records `isWrite` but does not
  gate on it), so a task can schedule tasks with nobody in the loop. `origin`
  records who queued each one and the UI separates them; that visibility is the
  control, not a cap.
- **Nothing in this repo drives the task cron.** As with markets, the scheduler
  is external. If it is not running, no scheduled task ever fires.

### Authenticator
- `GET /authenticator` → `{ accounts: IAuthenticatorAccount[] }` (no secrets)
- `GET /authenticator/codes` → `{ codes: IAuthenticatorCode[] }` — server-computed, used by the admin and desktop UIs
- `GET /authenticator/export` → `{ accounts: IAuthenticatorExportAccount[], exportedAt }` — **the only route that returns decrypted base32 secrets.** It exists so `apps/authenticator-extension` can hold an offline vault; a leaked API key here costs every secret, not one code. Do not call it from the web or desktop UIs, and do not persist its response anywhere unencrypted.
- `POST /authenticator` → `{ label, issuer, accountName, secret, algorithm?, digits?, period? }` → `{ account }`
- `PATCH /authenticator/{id}` → label/issuer/accountName only; a secret is never updated in place
- `DELETE /authenticator/{id}` → `{ success: true }`

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
- All server LLM traffic goes through `apps/web/lib/llm-service.ts` (Vercel AI Gateway; `AI_GATEWAY_API_KEY`). Never import a provider SDK or build provider URLs in app code — add operations to the service instead. Model ids are fully qualified Gateway ids; legacy dashed ids resolve via the service's alias map.
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
