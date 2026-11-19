# Stockwatcher

A private market and research workspace built with Next.js and shadcn/ui. A new workspace starts with an empty dashboard. Enter a request or click an example to open a view. Keep the assistant open to build on the result.

## What’s inside

- Price history with line and candlestick views, volume, a 20-bar moving average, and several time ranges.
- Global symbol search, market maps, an S&P 500 sector view, a sortable market table, and normalized comparisons for up to six tickers.
- Multiple watchlists and portfolios, a buy/sell ledger, CSV import and export, and average-cost P/L separated by quote currency.
- Company headlines and annual US GAAP figures, SEC filings, 13F holdings with CSV export, WallStreetBets mention counts, and a research journal.
- Account-scoped price alerts checked every two minutes when the monitor is enabled. Triggers appear in the app.
- Plain-language requests for market views, quote comparisons, company research, holdings, and alert setup. Follow up with “add the banks”, “remove Tesla”, or “show it since 1 January”. The app remembers the last requested dashboard. Replies include links that reopen the view after sign-in. Save frequently used requests and replay them with fresh data.
- With an AI Gateway key, a docked assistant streams answers and calls tools for quotes, history, SEC figures, 13F holdings, news, your portfolio P/L and web search. It remembers your positions, theses and preferences across conversations (editable under Memory), keeps a thread history, and can pin charts and notes to your desk.
- The desk is the home screen: a layout of widgets you or the assistant can add, remove and reorder, led by a daily brief written on the first visit each day. Without a key it falls back to a computed summary and the command-based assistant.

The [Stockwatcher plugin](https://github.com/ktoetotam/stockwatcher-plugin) and [the original article](https://msukhareva.substack.com/p/building-personalised-skills-an-agentic) inspired the workflows.

## Local development

Use Node 24 or newer.

```sh
bun install
bun dev
```

Open [localhost:3000](http://localhost:3000) and select **Open preview**. Preview creates a separate workspace in a local SQLite database. The app uses real upstream market data in preview mode.

```sh
bun run lint
bun run typecheck
bun run build
bunx playwright install chromium
bun run test
```

Use `PLAYWRIGHT_CHANNEL=chrome bun run test` to run against an installed Chrome. The tests start their own local OpenID Connect issuer and exercise a signed ID token, PKCE, account isolation, and workspace writes.

To run locally in Docker, use `DEMO_MODE=1 docker compose up --build`. The named volume preserves SQLite data across container replacements.

## Deniz Cloud sign-in

In [Deniz Cloud Auth → Apps](https://auth.denizlg24.com/apps), open a tenant and create a client named **Stockwatcher** with kind **Web app**. Tenant clients can admit ordinary Deniz Cloud accounts according to the tenant’s policies. The separate owner-level Clients screen creates credentials for superusers. The tenant requires one API on every client. Register **Stockwatcher identity** with identifier `https://stockwatcher.invalid/identity` and select it for the web client. This reserved URL is an OAuth identifier. Stockwatcher does not send requests to it. Deniz Cloud sets up authorization code with PKCE and `client_secret_basic` for the web client. Register the exact callback URI for each environment.

- Local callback `http://localhost:3000/auth/callback`
- Forge callback `https://stockwatcher.denizlg24.com/auth/callback`

Set `DENIZ_OIDC_CLIENT_ID` and `DENIZ_OIDC_CLIENT_SECRET` as runtime secrets. Set `APP_URL` to the canonical origin and leave `DENIZ_OIDC_ISSUER` at its default unless using a different Deniz Cloud installation. Stockwatcher requests `openid profile email`. It uses a host-only session cookie and keys workspaces by issuer and subject. To limit the app to specific accounts, set `WORKSPACE_ALLOWED_EMAILS` to a comma-separated list of their verified account addresses.

## Forge

Use a Dockerfile deployment with the repository root as the build context, `Dockerfile` as the build file, container port `3000`, and `/api/health` as the health path. The image runs as a non-root user and listens on the port passed by Forge.

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
| `AI_GATEWAY_API_KEY`                               | Server-side Vercel AI Gateway key. Enables the assistant, brief and memory. |
| `AI_GATEWAY_MODEL`                                 | Optional chat model ID. Defaults to `anthropic/claude-sonnet-5.5`.     |
| `AI_GATEWAY_BRIEF_MODEL`                           | Optional daily-brief model ID. Defaults to `AI_GATEWAY_MODEL`.         |
| `AI_GATEWAY_TEAM_ID`                               | Optional team ID or slug for requests scoped to a Vercel team.         |
| `MARKETS_RELAY_URL`, `MARKETS_RELAY_TOKEN_SECRET`  | Markets relay WebSocket URL and its signing secret. Enables live quotes. |

Forge replaces app containers during deploys. PostgreSQL keeps workspaces, alerts, and sessions across those replacements. The app creates its own prefixed tables on first connection. Grant the database role permission to create tables and indexes in its schema.

## Data coverage

Yahoo Finance provides quotes, history, symbol search, and news. The Russian market view uses delayed Moscow Exchange ISS quotes and history for a selection of Moscow-listed stocks. Quotes can be delayed. Timestamps use your device’s time zone. Trading symbols keep their exchange suffix and quote currency. Portfolio values require a quote in the transaction currency. The ledger uses average cost and records manual trades and fees. Broker synchronization, tax accounting, and corporate-action adjustments are outside that ledger.

The market map uses equal-sized tiles. The S&P 500 constituents are a bundled [DataHub snapshot](https://github.com/datasets/s-and-p-500-companies/tree/05c998c3e714b8dc9b621239bbdef92bccefc376) retrieved on 19 November 2026. SEC EDGAR provides annual US GAAP figures and the reported period for 13F holdings. ApeWisdom reports discussion activity.
