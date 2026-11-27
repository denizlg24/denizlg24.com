<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Stockwatcher

Moved in from the standalone `denizlg24/stockwatcher` repo on 2026-11-26 with
its history (`git subtree`). Product truth is `PRODUCT.md`, the visual system
`DESIGN.md`; operator detail (env, OIDC client, IBKR, alert channels) is in
`README.md`.

- **Not single-user.** Its users are the owner's father and anyone the tenant
  admits, signed in through a deniz auth *tenant* client, so the root
  "no explanatory copy" rule does not apply here. Tenant tokens never carry
  `superuser`; `/admin` is gated by `STOCKWATCHER_ADMIN_SUBJECTS` instead.
- **No workspace dependencies on purpose.** It talks to deniz auth over plain
  OIDC (`openid-client`), not `@denizlg24/auth`, and to the markets relay over
  its public WebSocket/HTTP contract. Keep it that way unless there is a reason
  to couple its release to `packages/*`.
- **`node:sqlite` backs preview workspaces**, so `next build` must run under
  node. The Dockerfile copies bun in only as the installer and builds with
  `bun run`, which hands `next`'s node shebang to the node on PATH. Do not
  switch the build stage to an `oven/bun` image.
- **Production state is Postgres** (Forge resource binding `DATABASE_URL`,
  `REQUIRE_DATABASE_URL=1`); the app creates its prefixed tables on first
  connection. SQLite under `/app/data` is container-local and only serves
  `DEMO_MODE` previews.
- **Background work runs on the worker when one is deployed.**
  `STOCKWATCHER_WORKER=1` on web (with `DATABASE_URL`) sends compute runs —
  the QuickJS sandbox and its data load — to the `stockwatcher_jobs` queue
  (`lib/jobs`: `FOR UPDATE SKIP LOCKED`, 60 s leases, one running job and at
  most five queued per user, dead-letter after two attempts) and turns off the
  in-process schedulers. The worker (`Dockerfile.worker`, one bundled file
  built by `scripts/build-worker.ts`, `/healthz`) runs the jobs plus the
  schedules: alerts every two minutes (`ALERT_MONITOR=1`), IBKR Flex every 30
  (`BROKER_SYNC`), run and job retention. A schedule fires once per period
  across every worker through a `stockwatcher_schedules` row, not a lock.
  Without the flag everything stays in-process in each web container, as
  before. The worker bundle must not import Next (`lib/auth`, `lib/admin`):
  the build fails if it does. Check it with `bun run worker:build && bun
  --env-file=.env.local scripts/worker-e2e.ts`.
- **Lint is Biome at the root.** The override in `biome.json` turns off the
  a11y, `!important` and control-character rules the app's old ESLint config
  never enforced; tighten it as components are touched.
- **Playwright e2e is `bun run test:e2e`**, not `test`, so `turbo test` and CI
  skip it. It starts its own OIDC and Flex fixtures and a dev server on 3290.
- Dev runs on port 3013 (`bun run dev:stockwatcher` at the root). The tenant
  client needs `http://localhost:3013/auth/callback` registered for local
  sign-in; preview mode works without it.
- **Credits are a Postgres ledger, Polar only takes the money.** Polar never
  blocks usage, so `lib/billing/credits.ts` is the hard limit: reserve a hold
  before any model call, settle at the gateway's reported cost
  (`providerMetadata.gateway.cost`, a decimal string per step) after. Every
  new model call must go through `reserve` + `meter`, or it is free. Spend
  below a request (a tool that calls `generateText`) is added with
  `addScopedCost` inside `withCostScope`. Plan:
  `docs/internal/plans/035-stockwatcher-multi-user.md`.
- **Per-user gateway keys are a backstop, not the meter.** With
  `VERCEL_API_TOKEN` and `AI_GATEWAY_TEAM_ID`, the Polar webhook creates a
  user's own AI Gateway key on their first purchase (name is a hash of the
  user id, team-attributed, sealed at rest) and re-fits its budget after every
  purchase or refund to all credits ever granted at cost plus $0.50, refresh
  `none`. Chat and the daily brief then run on that key (`modelsFor`); a 402
  `quota_for_entity_exceeded` reaches the client as out-of-credits. Supply-chain
  extraction stays on the app key: its results are cached and shared across
  users.
- **The news wire is `lib/news`, not Yahoo alone.** `companyNews` fans out to
  SEC EDGAR submissions (8-K/6-K items, Form 4), PR Newswire and Business
  Wire feeds (matched by `(NASDAQ: SYM)` tags), Finnhub (`FINNHUB_API_KEY`),
  Yahoo, Google News RSS and GDELT, caches each source fetch in
  `stockwatcher_news_cache` (in memory on SQLite), answers within 9 s with
  what arrived, and merges one story per event (`dedupe`: canonical URL or
  75% headline-word overlap; the filing or wire keeps the headline). A failing
  source sits out five minutes. GlobeNewswire and Reddit refuse server
  requests and are left out; GDELT allows one request per five seconds.
- **One-click channels need their provider apps.** Telegram, Discord and
  Slack connect through `lib/notify/connect.ts`: a one-time state in
  `stockwatcher_connect_states` (15 minutes, consumed on use) ties the
  approval back to the user, so the callbacks work without the session
  cookie. Telegram uses one Stockwatcher-owned bot (`TELEGRAM_BOT_*`,
  webhook at `/api/alerts/telegram/webhook` guarded by
  `TELEGRAM_WEBHOOK_SECRET`, set once with `scripts/telegram-setup.ts`); its
  token is copied into each channel's sealed config, so rotating the bot
  token means reconnecting. Browser push is the `push` channel kind
  (`web-push`, VAPID keys, `public/push-sw.js`). Each is hidden in the UI
  while its env is missing; the manual paths stay.

