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
  `addScopedStep` inside `withCostScope`, and must call `guardScopedSpend`
  first. A chat turn is budgeted per step (`lib/billing/budget.ts`): the
  first reservation must cover an estimate of the first step, and before
  every further step (a `stopWhen` condition) and every scoped model call the
  hold is grown to cover spend so far plus the next step projected from the
  last; when the account cannot cover it the turn stops and the reply carries
  `metadata.stopped = "credits"`. One 14-step turn spent 472 credits on a
  5-credit hold before this existed (2026-11-27). Chat is prompt-cached:
  `chatInstructions` returns a byte-stable rules block carrying an Anthropic
  cache breakpoint, then a per-turn state block (time, view, workspace,
  memories), and chat passes `gatewayOptions(userId, true)` so the gateway
  moves a second breakpoint along the messages. Anything per-turn added to the
  rules block (a timestamp, a count) silently turns every turn into a cache
  write. A cached step costs about 7% of an uncached one (53k-token fixed
  prompt: $0.134 written, $0.009 read). Brief and filing extraction are
  one-shot and stay uncached on purpose. Plan:
  `docs/internal/plans/035-stockwatcher-multi-user.md`.
- **Routines are scheduled chat turns.** `workspace.routines` holds a prompt
  and a daily/weekly/monthly local-hour schedule (`lib/routines.ts`, IANA
  zone, monthly days capped at 28). `lib/routine-runner.ts` runs them every
  five minutes wherever `ALERT_MONITOR=1` runs (worker schedule `routines`,
  or in-process without a worker), one per user per tick, three per tick.
  A run is claimed by writing `lastRun` through the workspace revision before
  the model is called, so two containers or a redeploy never answer one slot
  twice; a slot missed by downtime runs once, slots missed while paused are
  skipped (`resumedAt`). The turn is chat's: the same instructions plus a
  "nobody is watching" system block, the same per-step credit budget, metered
  as `source: "routine"`, minus the tools that drive the UI or wait for an
  answer. The answer is saved as a thread and delivered like a signal, with
  a `/?thread=<id>` link the dashboard opens in the assistant. Routine runs
  are not in the admin chat-runs log: `recordRun` lives in `lib/admin`, which
  the worker bundle must not import. `bun --env-file=.env.local
  scripts/routines-e2e.ts` runs one for a throwaway user against the real
  gateway (a few cents).
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
- **Alternative data is `lib/alt`, one dispatcher for every dataset.**
  `GET /api/alt?dataset=<name>` routes through `lib/alt/registry.ts` to the
  domain handlers in `lib/alt/handlers/{congress,gov,sec,market}.ts`; each
  returns `AltResult` (data, source, asOf, fetchedAt, stale). Reads go
  through `cached()` (`stockwatcher_alt_cache`, memory on SQLite): a failed
  refresh serves the last good copy marked stale, a transient failure cools
  the source two minutes, immutable documents (a PTR by DocID, a 13F by
  accession) cache forever. The registry's warmers run on the worker as
  `alt:<name>` schedules, or in-process where `ALERT_MONITOR=1`, so feeds
  stay live without a reader (`ALT_WARM=0` turns them off). Government
  records name companies, not tickers: `lib/alt/entities.ts` resolves names
  against SEC's ticker file, accepting a shortened prefix only when every
  dropped word is a division word, with curated overrides for brands and
  subsidiaries — fix a wrong match there, not in a domain. Only sources
  whose terms allow a paid product are here, except the non-commercial ones
  (Reddit/WSB mentions, Google Play, ADS-B flights), which are read from the
  markets relay's archive (`/v1/archive/*` through `relayGet`, needs
  `MARKETS_ARCHIVE_DATABASE_URL` on the relay; `lib/alt/archive`, WSB and ACFT
  functions, APPR's Google Play section). The owner chose to expose them
  despite their non-commercial terms (ApeWisdom/Reddit, Google Play scraping,
  OpenSky/adsb.lol licences); an archive that is off reads as a permanent 503.
  Keys:
  `FEC_API_KEY` (DEMO_KEY allows ~10 calls an hour), `LDA_API_KEY`,
  `USPTO_API_KEY` (patents are off without it), `OPENFIGI_API_KEY`
  optional. LDA and Senate eFD answer 403 (Akamai) to every client tried on
  2026-11-28, headless Chromium included, so they are likely blocked from
  the home network that hosts Forge too; plan 037 lists paid replacements. 13F reports keep every
  position, roughly 0.7 MB a filing in the cache.
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
- **`/account` owns the profile picture; deniz auth owns the rest.** The
  picture is a 256 px square the browser crops and encodes (WebP, JPEG on
  Safari), capped at 256 KB, sniffed by magic bytes and stored in
  `stockwatcher_profile_pictures` (`profile_pictures` on SQLite); it is
  served only to its owner at `/api/account/picture?v=<updated ms>`,
  immutable per version. The identity's `image` was not used: the API has
  no upload path, and a data URL there would ride in every session read and
  ID token. Name, password and two-factor link out to deniz auth
  (`DENIZ_AUTH_APP_URL`, default `https://auth.denizlg24.com`) with
  `client_id` and a `returnTo` on `APP_URL`, which deniz auth verifies
  against this client's registered redirect origins before drawing "Back to
  Stockwatcher". The name is captured at sign-in, so a change shows after
  the next sign-in.
- **`/mcp` is the users' MCP server, authenticated by personal access
  tokens.** `/account` creates `swk_…` tokens (sha256 at rest, shown once,
  `read` or `write`, ten per user); `app/mcp/route.ts` resolves the bearer,
  rate-limits 120 requests a minute per token and container, and serves
  `lib/mcp/server.ts`, which re-exposes an allowlist of the assistant's own
  tools through `@modelcontextprotocol/server` (stateless, one server per
  request). Tools that run a model (the security profile's supply-chain read,
  web search) or drive the app's UI are left out, because they would bypass
  credits or mean nothing outside the app; add a tool to the allowlist only
  if it is neither. `scripts/mcp-e2e.ts` checks it against a running app.
  OAuth for claude.ai connectors needs a tenant MCP resource in `apps/api`
  first.

