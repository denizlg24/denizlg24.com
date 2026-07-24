# Cloud 008: `apps/cloud` — the admin app (cloud.denizlg24.com)

> **Executor instructions**: Follow step by step. Run every verification
> command. On STOP conditions, stop and report. When done, update
> `plans/cloud/README.md`.

## Status

- **Executor**: fable 5
- **Effort**: XL
- **Risk**: MED
- **Depends on**: 003, 006 (007 for the terminal tab — if 007 isn't DONE,
  build everything else and leave the terminal tab behind a "coming soon"
  gate; record in Drift log)
- **Category**: full-stack UI

## Why

Replaces the old Vite SPA admin (`vendor/deniz-cloud/packages/admin-ui` —
pages: dashboard, users, projects, databases, storage, tasks, tools,
login). Next.js app deployed on Vercel, talking to `api.denizlg24.com` with
better-auth cross-subdomain sessions. This is where "better UI, less cardy"
happens.

## Design direction (operator-stated)

- **Not cardy/boxy**: the old UI is shadcn-default card grids. Target the
  monorepo's established minimalist/editorial style (see `apps/desktop` and
  the plan-005/007 design docs in `plans/` root — read
  `plans/005-responsive-admin-spike.md` findings). Dense tables, generous
  whitespace, typographic hierarchy over borders, restrained color.
- Reuse `@repo/ui` primitives everywhere; if a needed primitive exists only
  in the old admin-ui, rebuild it in the app (promotion to `@repo/ui`
  happens in plan 010, not here).
- Charts for observability: recharts (already in the repo family) with a
  quiet, consistent palette; sparklines in tables where a full chart is
  noise.
- Responsive: usable on a phone (the operator will manage this from abroad).

## Auth & data conventions

- better-auth client (from 003) against `NEXT_PUBLIC_CLOUD_API_URL`
  (`https://api.denizlg24.com`; dev `http://localhost:3001` — whatever port
  apps/api dev uses; align and document in the app README).
- All fetches through one typed client module (`lib/api.ts`) validating
  responses with `@repo/schemas` `cloud/*` zod schemas — no untyped fetch.
  Server Components may fetch server-side where it helps; mutations via
  client with credentials: "include".
- Route guard: unauthenticated → /login; non-superuser → signed-out with
  message (admin app is superuser-only, matching old behavior).

## Scope (screens)

1. **Login** — email/username + password, TOTP step, recovery-code path.
2. **Dashboard/Observability** — the 006 metrics: current gauges (CPU, mem,
   temp, per-disk usage incl. tier headroom), time-series (24h/7d/90d) for
   cpu/mem/net/disk, per-container table (state, mem, cpu, restart action),
   service health strip (from `/api/ops/health`), recent task runs. This is
   the flagship screen — invest here.
3. **Users** — list/create pending (username), delete, reset MFA, role
   badge, signup-status. (Old: `users.tsx`.)
4. **Projects** — list + detail drill-down: API keys (create w/ scope
   picker, rotate, revoke, copy-once), **per-project S3 credentials (NEW
   capability from 004/005 — create with label, secret shown once, rotate,
   revoke, last-used display; plus a visible "legacy shared credential"
   row at the admin level flagged for post-cutover retirement)**, storage
   folder link,
   provisioned databases (create postgres/mongodb/redis, credentials
   copy-once, deprovision w/ confirmation typing the name), search
   collections (create/pause/resume/resync/delete, field mapping editor),
   vector indexes (mongot), tenant token generator w/ TTL.
5. **Databases** — the admin db surfaces from 005 (`db-postgres`,
   `db-mongodb` inspection); embed/link Adminer + mongo-express equivalents:
   old repo iframed internal adminer/mongo-express via admin-api proxy —
   keep those two containers and the authenticated proxy route (port
   `admin-api/src/proxy.ts` semantics into apps/api under
   `/api/ops/tools/*`; superuser-only) and iframe them here.
6. **Tasks** — scheduled task CRUD (cron editor with next-runs preview,
   executor-typed config forms from zod), run history w/ log tail viewer,
   manual trigger. Includes the NEW `tiering_pass` task (006): watermark/
   age/size config form, a **dry-run button rendering the would-move report**
   (files, sizes, direction, reason) before enabling the nightly schedule,
   and per-run moved-bytes summary in history.
7. **Terminal** — xterm.js client speaking 007's protocol (ticket fetch →
   wss), session list/attach/kill, fit-addon resize, reconnect banner.
8. **Settings** — own account (password change, TOTP re-enroll, backup
   codes), and read-only display of environment/topology info.

Backend gaps discovered while building (missing endpoint/field): add to
`apps/api` + schemas in the same session — you own the integrated slice;
note additions in the Drift log so gpt5.6 plans' owners see them.

## Verification

```
bunx turbo typecheck --filter=cloud --filter=api
bunx turbo test --filter=cloud --filter=api
bunx turbo build --filter=cloud
bun run format-and-lint
# manual e2e vs dev infra + dev api: login (TOTP), create project → key →
# provision postgres → see it in Databases; dashboard renders live metrics;
# responsive pass at 375/768/1280 (screenshot or headless check).
```

## STOP conditions

Runbook STOPs, plus: cross-subdomain session doesn't hold in local dev
(don't hack cookies clientside — fix dev origins config or report); any
screen requires bypassing zod-validated client.

## Drift log

- **From 004 (2026-07-23):** Consume `tieringReportSchema` from
  `@repo/schemas/cloud` for the tiering dry-run UI. Plan 006 owns the admin
  endpoint/task executor that invokes 004's exported `runTieringPass`; do not
  trigger a real move from the UI during cutover or the 48-hour soak.
- **From 006 (2026-07-24):** Consume the canonical contracts in
  `@repo/schemas/cloud/ops` and the superuser-only `/api/ops` routes for
  overview, bounded/downsampled metrics, tasks/run history/manual triggers,
  containers/restarts, and component health. Mongo backup task forms may select
  at most one database. The default metrics rollup is enabled; nightly tiering
  is seeded disabled.
- **From 007 (2026-07-24):** Mint terminal access with
  `POST /api/ops/terminal` (optional `{sessionId}`), then connect to
  `/api/ops/terminal/ws?ticket=...` using the returned 30-second one-use
  ticket. The response also supplies `sessionId` and `expiresAt`. Use canonical
  frames from `@repo/schemas/cloud`; PTY data is binary and controls are text
  JSON. Reply to server `ping` with `pong`. Existing sessions can be listed or
  killed with `GET`/`DELETE /api/ops/terminal/sessions[/:id]`.
