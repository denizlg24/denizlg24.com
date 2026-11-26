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
- **Background work runs in-process** from `instrumentation.ts`: alert checks
  every two minutes (`ALERT_MONITOR=1`) and the IBKR Flex sync every 30
  minutes (`BROKER_SYNC`), in every container Forge runs.
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
