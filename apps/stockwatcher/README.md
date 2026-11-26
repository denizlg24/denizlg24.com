# Stockwatcher

A private market and research workspace built with Next.js and shadcn/ui. A new workspace starts with an empty dashboard. Enter a request or click an example to open a view. Keep the assistant open to build on the result.

## What’s inside

- Price history with line and candlestick views, volume, a 20-bar moving average, and several time ranges.
- Global symbol search, market maps, an S&P 500 sector view, a sortable market table, and normalized comparisons for up to six tickers.
- Multiple watchlists and portfolios, a buy/sell ledger, CSV import and export, and average-cost P/L separated by quote currency.
- Interactive Brokers sync. Under **Portfolio → Connect Interactive Brokers**, paste a Flex Query ID and token once. Stockwatcher then pulls open positions, cost basis and cash into a read-only portfolio per IBKR account, every six hours and on demand.
- Company headlines and annual US GAAP figures, SEC filings, 13F holdings with CSV export, WallStreetBets mention counts, and a research journal.
- Account-scoped alerts on price, day change, move since set, or volume, checked every two minutes when the monitor is enabled. Alerts can fire once or re-arm after each crossing, expire on a date, and carry a note. Set one from the Alerts page, from the chart's bell tool, or by right-clicking a chart. Every trigger is logged in the app and can also go to email, WhatsApp, Telegram, Discord, Slack, ntfy phone push, a signed webhook, or desktop notifications.
- Plain-language requests for market views, quote comparisons, company research, holdings, and alert setup. Follow up with “add the banks”, “remove Tesla”, or “show it since 1 January”. The app remembers the last requested dashboard. Replies include links that reopen the view after sign-in. Save frequently used requests and replay them with fresh data.
- With an AI Gateway key, a docked assistant streams answers and calls tools for quotes, history, SEC figures, 13F holdings, news, your portfolio P/L and web search. It remembers your positions, theses and preferences across conversations (editable under Memory), keeps a thread history, and can pin charts and notes to your desk.
- The desk is the home screen: a layout of widgets you or the assistant can add, remove and reorder, led by a daily brief written on the first visit each day. Without a key it falls back to a computed summary and the command-based assistant.

The [Stockwatcher plugin](https://github.com/ktoetotam/stockwatcher-plugin) and [the original article](https://msukhareva.substack.com/p/building-personalised-skills-an-agentic) inspired the workflows.

## Local development

Stockwatcher lives at `apps/stockwatcher` in the denizlg24.com monorepo. Put local settings in `apps/stockwatcher/.env.local` (see `.env.example`); Next reads it directly. From the repository root:

```sh
bun install
bun run dev:stockwatcher
```

Open [localhost:3013](http://localhost:3013) and select **Open preview**. Preview creates a separate workspace in a local SQLite database. The app uses real upstream market data in preview mode.

```sh
bunx turbo run typecheck build --filter=stockwatcher
bun run format-and-lint
cd apps/stockwatcher && bunx playwright install chromium && bun run test:e2e
```

Use `PLAYWRIGHT_CHANNEL=chrome bun run test:e2e` to run against an installed Chrome. The tests start their own local OpenID Connect issuer and exercise a signed ID token, PKCE, account isolation, and workspace writes. They are not part of `turbo test`, so CI does not run them.

To check the production image, build it from the repository root: `docker build -f apps/stockwatcher/Dockerfile .`.

## Deniz Cloud sign-in

In [Deniz Cloud Auth → Apps](https://auth.denizlg24.com/apps), open a tenant and create a client named **Stockwatcher** with kind **Web app**. Tenant clients can admit ordinary Deniz Cloud accounts according to the tenant’s policies. The separate owner-level Clients screen creates credentials for superusers. The tenant requires one API on every client. Register **Stockwatcher identity** with identifier `https://stockwatcher.invalid/identity` and select it for the web client. This reserved URL is an OAuth identifier. Stockwatcher does not send requests to it. Deniz Cloud sets up authorization code with PKCE and `client_secret_basic` for the web client. Register the exact callback URI for each environment.

- Local callback `http://localhost:3013/auth/callback`
- Forge callback `https://stockwatcher.denizlg24.com/auth/callback`

Set `DENIZ_OIDC_CLIENT_ID` and `DENIZ_OIDC_CLIENT_SECRET` as runtime secrets. Set `APP_URL` to the canonical origin and leave `DENIZ_OIDC_ISSUER` at its default unless using a different Deniz Cloud installation. Stockwatcher requests `openid profile email`. It uses a host-only session cookie and keys workspaces by issuer and subject. To limit the app to specific accounts, set `WORKSPACE_ALLOWED_EMAILS` to a comma-separated list of their verified account addresses.

## Forge

Forge target `stockwatcher/web` builds `denizlg24/denizlg24.com` with root directory `apps/stockwatcher`: the repository root is the build context and `apps/stockwatcher/Dockerfile` the build file, container port `3000`, and `/api/health` as the health path. The image runs as a non-root user and listens on the port passed by Forge.

Set these production runtime values in Forge.

| Variable                                           | Value                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `APP_URL`                                          | Canonical public HTTPS origin                                          |
| `DENIZ_OIDC_CLIENT_ID`, `DENIZ_OIDC_CLIENT_SECRET` | Stockwatcher OAuth client credentials                                  |
| `DATABASE_URL`                                     | Dedicated PostgreSQL database URL, with provider-required TLS settings |
| `REQUIRE_DATABASE_URL`                             | `1`                                                                    |
| `DEMO_MODE`                                        | `0`                                                                    |
| `ALERT_MONITOR`                                    | `1`                                                                    |
| `SEC_USER_AGENT`                                   | Application name and an operator contact email                         |
| `WORKSPACE_ALLOWED_EMAILS`                         | Optional list of permitted, verified email addresses                   |
| `STOCKWATCHER_ADMIN_SUBJECTS`                      | Optional comma-separated Deniz Cloud user ids that can open `/admin`. Empty means nobody. |
| `AI_GATEWAY_API_KEY`                               | Server-side Vercel AI Gateway key. Enables the assistant, brief and memory. |
| `AI_GATEWAY_MODEL`                                 | Optional chat model ID. Defaults to `anthropic/claude-sonnet-5.5`.     |
| `AI_GATEWAY_BRIEF_MODEL`                           | Optional daily-brief model ID. Defaults to `AI_GATEWAY_MODEL`.         |
| `AI_GATEWAY_TEAM_ID`                               | Optional team ID or slug for requests scoped to a Vercel team.         |
| `MARKETS_RELAY_URL`, `MARKETS_RELAY_TOKEN_SECRET`  | Markets relay WebSocket URL and its signing secret. Enables live quotes. |
| `BROKER_SECRET`                                    | Optional key that encrypts stored broker tokens. Defaults to a key derived from `DENIZ_OIDC_CLIENT_SECRET`. Rotating it requires reconnecting. |
| `BROKER_SYNC`                                      | Set to `0` to turn off the six-hourly background broker sync.          |
| `MARKETS_DATA_URL`, `MARKETS_DATA_TOKEN`  | Optional HTTP origin and bearer token for the relay data API behind the security functions and monitors. Default to the relay URL and signing secret. |

Forge replaces app containers during deploys. PostgreSQL keeps workspaces, alerts, and sessions across those replacements. The app creates its own prefixed tables on first connection. Grant the database role permission to create tables and indexes in its schema.

## Admin

`/admin` is an owner-only audit of the in-app assistant. It lists every user, their threads and workspace counts, and each assistant request with its prompt, tool calls, errors, token usage and timing. Thread pages show the full transcript, including tool inputs, outputs and error text, with the matching run beside each reply. Runs are kept when a user deletes the thread.

Deniz Cloud does not put a superuser claim on tenant-client tokens, so access is set by configuration. Add your Deniz Cloud user id (the `sub` claim) to `STOCKWATCHER_ADMIN_SUBJECTS`. A full workspace id in the form `issuer|sub` also works. Everyone else, including preview sessions, gets a 404. Admins see an **Assistant audit** link in the account menu.

## Data coverage

Yahoo Finance provides quotes, history, symbol search, and news. The Russian market view uses delayed Moscow Exchange ISS quotes and history for a selection of Moscow-listed stocks. Quotes can be delayed. Timestamps use your device’s time zone. Trading symbols keep their exchange suffix and quote currency. Portfolio values require a quote in the transaction currency. The ledger uses average cost and records manual trades and fees. Tax accounting and corporate-action adjustments are outside that ledger.

## Interactive Brokers

IBKR offers OAuth sign-in only to licensed organizations and approved third-party vendors. Individual accounts cannot use it. Stockwatcher therefore uses the read-only [Flex Web Service](https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service/), which needs no gateway and cannot trade. The account holder sets it up once in the Client Portal under Performance & Reports → Flex Queries:

1. Create an Activity Flex Query with **Open Positions** (Lot or Summary detail, all fields). **Cash Report** is optional. Use XML format and the Last Business Day period. Note the Query ID.
2. Under Flex Web Service Configuration, enable the service and generate a token with the longest expiry.
3. In Stockwatcher, open Portfolio → Connect Interactive Brokers and paste both values.

The token is stored server-side with AES-256-GCM encryption and never reaches the browser. Each IBKR account becomes one portfolio whose positions are server-owned. Rename it freely. Trades cannot be edited there. Lot-level queries keep each lot's open date. Summary queries record one entry per position at its average cost. Long stock and ETF positions on the major US, European, and Asia-Pacific venues are tracked. Options, futures, bonds, shorts, and unmapped venues are listed under "Not tracked". An expired token marks the link as needing a new token. Disconnecting deletes the token and keeps the last snapshot as a manual portfolio.

## Alert notifications

Each user connects channels under Alerts → Where alerts reach you, following an illustrated guide per service. Stockwatcher sends a real test message before saving a channel. Channel settings are stored server-side with AES-256-GCM encryption and are never sent to the browser.

| Channel | What it needs |
| --- | --- |
| Email | `RESEND_API_KEY` on the server and a sender on a domain verified in Resend (`ALERT_EMAIL_FROM`, default `alerts@auth.denizlg24.com`). Alerts go only to the address on the signed-in account. |
| WhatsApp | The free [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/) API key for the user's own number. |
| Telegram | A bot made with @BotFather. The guide finds the chat ID after the user messages the bot. |
| Discord, Slack | An incoming webhook URL. |
| ntfy | A topic in the [ntfy](https://ntfy.sh) app. A self-hosted ntfy server and access token are optional. |
| Webhook | Any public HTTPS endpoint. Requests carry `X-Stockwatcher-Signature: sha256=<HMAC of the body>` using the secret shown once at setup. Private and reserved addresses are refused at connect time, and redirects are not followed. |

The monitor saves the trigger before sending, so a crash or a concurrent edit never delivers twice. Delivery results appear in the Activity list. A failing channel is flagged on its card. Test messages are limited to eight per user every ten minutes. Preview sessions cannot add channels.

The market map uses equal-sized tiles. The S&P 500 constituents are a bundled [DataHub snapshot](https://github.com/datasets/s-and-p-500-companies/tree/05c998c3e714b8dc9b621239bbdef92bccefc376) retrieved on 19 November 2026. SEC EDGAR provides annual US GAAP figures and the reported period for 13F holdings. ApeWisdom reports discussion activity.
