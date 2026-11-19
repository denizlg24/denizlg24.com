# Markets data relay

The relay serves Yahoo Finance data through yfinance and economic observations through FRED. Web and desktop Markets screens use it through their existing admin API. Other apps can use the HTTP API from a trusted backend or open a WebSocket with a short-lived token minted by their backend.

## Run locally

```sh
bun install --frozen-lockfile --filter markets-relay
uv sync --locked --project apps/markets-relay/python
MARKETS_RELAY_TOKEN_SECRET=local-development-only bun run --cwd apps/markets-relay start
```

The public process defaults to port 3004. It starts a Python worker on loopback port 3014. Override these ports with `PORT` and `MARKETS_WORKER_PORT`. The existing dev Compose workflow also builds the relay. The web server uses the HTTP(S) origin of `NEXT_PUBLIC_MARKETS_RELAY_URL` by default. Set `MARKETS_DATA_URL` on the web server for a separate internal HTTP(S) origin.

## HTTP API

Send `Authorization: Bearer <token>` with each request. Set `MARKETS_DATA_TOKEN` on the relay and its backend consumers for a dedicated HTTP credential. It defaults to the WebSocket signing secret. Keep both credentials on servers. TypeScript apps can import `MarketDataClient` from `@repo/markets/client` for methods and response validation.

| GET path | Data |
| --- | --- |
| `/v1/search?q=Apple&limit=10` | Ticker and company-name search across exchanges and asset classes |
| `/v1/quotes?tickers=AAPL,BTC-USD` | Up to 200 snapshots with market timestamps and a list of missing symbols |
| `/v1/history/AAPL?resolution=1day&from=2025-01-01&to=2025-12-31&adjusted=true` | OHLCV with inclusive dates and minute through monthly resolutions |
| `/v1/instruments/AAPL` | Instrument metadata and company profile |
| `/v1/actions/AAPL` | Dividend and split history |
| `/v1/news/AAPL?limit=10` | Recent related headlines and publisher links |
| `/v1/financials/AAPL?statement=income&frequency=quarterly` | Fiscal periods and reported values for income, balance sheet, or cash flow |
| `/v1/macro` | FRED series catalog with units and frequency |
| `/v1/macro/CPIAUCSL?from=2020-01-01` | Dated economic observations |

History resolutions are `1min`, `5min`, `15min`, `30min`, `1hour`, `1day`, `1week`, and `1month`. Yahoo limits intraday history by resolution. Daily and longer bars use the exchange calendar date at midnight UTC. Intraday bars use the actual UTC timestamp. With `adjusted=false`, history uses Yahoo's Close and OHLC fields, which can still reflect stock splits. Financial statement values retain Yahoo's original reporting units and field names. The paper-trading ledger reads the same data through web's Mongo cache, storing raw and adjusted daily bars side by side.

The HTTP service marks expired results served during an upstream failure as stale. The health endpoint `/healthz` reports worker readiness and the current streaming connection state. Yahoo market-data timing depends on the exchange and instrument. FRED observations follow the publisher's release schedule and can be revised.

## WebSocket

Connect to `/ws?token=<short-lived-token>`. The existing web endpoint `POST /api/admin/markets/realtime/token` issues tokens for admin sessions. A trusted service holding the signing secret can also use `mintRelayToken` from `@repo/markets/core`. Configure `MARKETS_RELAY_ALLOWED_ORIGINS` with the browser origins that will connect.

Send `{"type":"subscribe","tickers":["AAPL","BTC-USD"]}` or `{"type":"unsubscribe","tickers":["AAPL"]}`. The relay sends `ready` messages with connection status and batched `quotes` with provider timestamps. Send `{"type":"ping"}` periodically and expect a `pong`. The relay shares one upstream subscription across clients and disconnects from Yahoo when nobody is subscribed.

Yahoo Finance describes its API as intended for personal use. Check the relevant terms and exchange data rights before distributing data to other users. [yfinance project documentation](https://github.com/ranaroussi/yfinance#readme)
