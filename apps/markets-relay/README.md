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
| `/v1/stats/AAPL` | Valuation, profitability, trading, dividend and fundamental statistics. Ratios are fractions and missing values are null |
| `/v1/analysts/AAPL` | Recommendation, price targets, rating trend, and the latest 25 upgrades and downgrades |
| `/v1/holders/AAPL` | Ownership breakdown, top institutions and funds, and recent insider transactions |
| `/v1/earnings/AAPL` | Next earnings date with estimates and up to 12 reported quarters with surprise as a fraction |
| `/v1/movers?list=gainers&limit=25` | Day gainers, losers, or most active symbols. `percent` is in percent units (5.2 = +5.2%) |
| `/v1/people/AAPL` | Company officers with age, birth year and pay, plus governance risk scores |
| `/v1/peers/AAPL` | Yahoo's similar symbols with scores, plus sector and industry |
| `/v1/macro` | FRED series catalog with units and frequency |
| `/v1/macro/CPIAUCSL?from=2020-01-01` | Dated economic observations |

History resolutions are `1min`, `5min`, `15min`, `30min`, `1hour`, `1day`, `1week`, and `1month`. Yahoo limits intraday history by resolution. Daily and longer bars use the exchange calendar date at midnight UTC. Intraday bars use the actual UTC timestamp. With `adjusted=false`, history uses Yahoo's Close and OHLC fields, which can still reflect stock splits. Financial statement values retain Yahoo's original reporting units and field names. The paper-trading ledger reads the same data through web's Mongo cache, storing raw and adjusted daily bars side by side.

The HTTP service marks expired results served during an upstream failure as stale. The health endpoint `/healthz` reports worker readiness and the current streaming connection state. Yahoo market-data timing depends on the exchange and instrument. FRED observations follow the publisher's release schedule and can be revised.

## Personal data archive

The relay can also collect datasets whose free sources are non-commercial or forbid redistribution into its own Postgres database, so history accrues for the owner's personal use. Nothing here is exposed to any app; the endpoints sit behind the same data token. With `MARKETS_ARCHIVE_DATABASE_URL` unset the archive is off and the relay behaves as before. `/healthz` reports `archive: { enabled, ready }`.

Collectors, each on its own jittered interval with failure backoff (capped at six hours) and one run in flight at a time:

| Collector | Source | Interval | Tables |
| --- | --- | --- | --- |
| `wsb` | ApeWisdom `wallstreetbets` and `all-stocks`, page 1 | 15 min | `archive_wsb` |
| `play` | Google Play store pages for about 55 ticker to package ids | checked every 3 h, one row per package per UTC day | `archive_play` |
| `flights` | FAA registry owners matched to listed companies (daily at most), then adsb.lol positions, OpenSky anonymous as fallback | registry 6 h check, positions 3 min | `archive_faa_registry`, `archive_flight_positions`, `archive_flights` |
| `feargreed` | CNN Fear & Greed graphdata | 15 min during the US session, hourly otherwise | `archive_fear_greed`, `archive_fear_greed_daily` |

Tables are created on startup and are append-only with natural keys. `archive_collector_state` holds each collector's last run, success and error, and a restart waits out the remaining interval instead of refetching. `feargreed` stores a snapshot only when CNN's score or source timestamp changes, and upserts the daily history it returns on every run.

Flights are derived, not copied: an aircraft reported on the ground and then airborne opens a flight, and a ground fix closes it. A flight whose aircraft goes quiet for 30 minutes closes at the last position heard with `arrival_observed = false`, and one first seen airborne has `departure_observed = false`. Positions are stored on state changes and every five minutes while airborne. Aircraft that only appear as Mode S without a position are not stored. The FAA zip is read over HTTP range requests by `python/zip_member.py` (standard library only), so nothing large touches the read-only filesystem or tmpfs. Owner patterns are in `src/archive/flight-companies.ts`; Amazon is limited to fixed-wing aircraft because most of its registrations are drones, and NetJets is left out on purpose.

Read endpoints, all `GET`, bounded by `limit` (default 500, at most 5000) and newest first:

| Path | Parameters |
| --- | --- |
| `/v1/archive/status` | Per collector: last run, last success, last error, failure streak, row counts |
| `/v1/archive/wsb` | `ticker`, `from`, `filter=wallstreetbets\|all-stocks`, `limit` |
| `/v1/archive/play` | `ticker`, `from`, `limit` |
| `/v1/archive/flights` | `ticker`, `from`, `icao24`, `view=flights\|positions\|registry`, `limit` |
| `/v1/archive/fear-greed` | `from`, `view=snapshots\|daily`, `limit` |

Setup on the Pi:

```sh
docker exec -i deniz-cloud-postgres-1 psql -U admin -d denizcloud -c 'CREATE DATABASE markets_archive'
```

Then add to `/opt/markets-relay/.env.markets` and redeploy the relay:

```sh
MARKETS_ARCHIVE_DATABASE_URL=postgres://user:pass@host.docker.internal:5433/markets_archive
# optional: comma-separated subset of wsb,play,flights,feargreed (default all)
MARKETS_ARCHIVE_COLLECTORS=
# optional: replace the Play app list; inline JSON or a path readable in the container
# [{"ticker":"META","package":"com.facebook.katana"}]
MARKETS_ARCHIVE_PLAY_APPS=
```

The compose service maps `host.docker.internal` to the host gateway, which is how the container reaches Postgres published on host port 5433. If the database is down at boot the relay retries every 30 seconds in the background. The Play and CNN sources are scraped and can change without notice; a page that no longer parses is recorded as a failure rather than as nulls. adsb.lol allows about one request per ten seconds, so the flight poll sends one request for up to 300 aircraft.

## WebSocket

Connect to `/ws?token=<short-lived-token>`. The existing web endpoint `POST /api/admin/markets/realtime/token` issues tokens for admin sessions. A trusted service holding the signing secret can also use `mintRelayToken` from `@repo/markets/core`. Configure `MARKETS_RELAY_ALLOWED_ORIGINS` with the browser origins that will connect.

Send `{"type":"subscribe","tickers":["AAPL","BTC-USD"]}` or `{"type":"unsubscribe","tickers":["AAPL"]}`. The relay sends `ready` messages with connection status and batched `quotes` with provider timestamps. Send `{"type":"ping"}` periodically and expect a `pong`. The relay shares one upstream subscription across clients and disconnects from Yahoo when nobody is subscribed.

Yahoo Finance describes its API as intended for personal use. Check the relevant terms and exchange data rights before distributing data to other users. [yfinance project documentation](https://github.com/ranaroussi/yfinance#readme)
