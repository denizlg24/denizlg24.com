import asyncio
import json
import logging
import time
from collections import OrderedDict
from datetime import date
from typing import Annotated, Literal

import provider
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from yfinance.exceptions import YFRateLimitError

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
log = logging.getLogger("uvicorn.error")
MAX_SYMBOLS = 200
MAX_IN_FLIGHT = 32
MAX_CACHE_ROWS = 80_000
cache = OrderedDict()
in_flight = {}
workers = asyncio.Semaphore(6)

DateFrom = Annotated[date | None, Query(alias="from")]
DateTo = Annotated[date | None, Query(alias="to")]
Resolution = Literal[
    "1min", "5min", "15min", "30min", "1hour", "1day", "1week", "1month"
]


async def lookup(key, ttl, load, *args, stale_for=0):
    now = time.monotonic()
    entry = cache.get(key)
    if entry and entry[0] > now:
        cache.move_to_end(key)
        return entry[1]

    async def fetch():
        try:
            async with workers:
                data = await asyncio.to_thread(load, *args)
            rows = sum(
                len(data.get(field, []))
                for field in ("bars", "observations", "actions")
            )
            cache[key] = (time.monotonic() + ttl, data, max(rows, 1))
            cache.move_to_end(key)
            count = sum(record[2] for record in cache.values())
            while len(cache) > 256 or count > MAX_CACHE_ROWS:
                _, removed = cache.popitem(last=False)
                count -= removed[2]
            return data
        except HTTPException:
            raise
        except Exception as error:
            log.warning("%s upstream failed (%s)", key[0], type(error).__name__)
            if entry and entry[0] + stale_for > time.monotonic():
                data = entry[1]
                if "freshness" in data:
                    return {**data, "freshness": {**data["freshness"], "stale": True}}
                return {**data, "stale": True}
            code = 503 if isinstance(error, YFRateLimitError) else 502
            raise HTTPException(code, "Upstream data unavailable") from error
        finally:
            in_flight.pop(key, None)

    if key not in in_flight:
        if len(in_flight) >= MAX_IN_FLIGHT:
            raise HTTPException(503, "Provider busy, retry shortly")
        in_flight[key] = asyncio.create_task(fetch())
        # A client may disconnect before the shared lookup completes.
        in_flight[key].add_done_callback(
            lambda task: task.exception() if not task.cancelled() else None
        )
    return await asyncio.shield(in_flight[key])


@app.get("/healthz")
async def health():
    return {"status": "ok"}


@app.get("/v1/search")
async def search(
    q: Annotated[str, Query(max_length=100)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
):
    query = q.strip()
    if not query:
        return {"results": []}
    return await lookup(
        ("search", query.casefold(), limit), 300, provider.search, query, limit
    )


@app.get("/v1/quotes")
async def quotes(tickers: Annotated[str, Query(min_length=1, max_length=5000)]):
    symbols = list(
        dict.fromkeys(provider.ticker_value(value) for value in tickers.split(","))
    )
    if len(symbols) > MAX_SYMBOLS:
        raise HTTPException(422, f"At most {MAX_SYMBOLS} symbols")
    records = []

    # Schedule requests in waves so a single large batch cannot fill the queue.
    async def snapshot(symbol):
        def load():
            return {"quote": provider.snapshot(symbol), "stale": False}

        return await lookup(("quote", symbol), 30, load, stale_for=3600)

    try:
        async with asyncio.timeout(22):
            for offset in range(0, len(symbols), 6):
                records.extend(
                    await asyncio.gather(
                        *(snapshot(symbol) for symbol in symbols[offset : offset + 6]),
                        return_exceptions=True,
                    )
                )
    except TimeoutError:
        pass
    results = []
    unavailable = list(symbols[len(records) :])
    stale = bool(unavailable)
    for symbol, record in zip(symbols, records):
        if isinstance(record, Exception):
            stale = True
            unavailable.append(symbol)
        elif not record["quote"]:
            unavailable.append(symbol)
        else:
            results.append(record["quote"])
            stale |= record["stale"]
    if not results and stale:
        failure = next(
            (record for record in records if isinstance(record, HTTPException)), None
        )
        if failure:
            raise failure
        raise HTTPException(503, "Quote request timed out")
    return {"quotes": results, "missing": unavailable, "stale": stale}


@app.get("/v1/instruments/{ticker}")
async def instrument(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("instrument", symbol), 3600, provider.instrument, symbol, stale_for=86400
    )


@app.get("/v1/history/{ticker}")
async def history(
    ticker: str,
    resolution: Resolution = "1day",
    adjusted: bool = True,
    start: DateFrom = None,
    end: DateTo = None,
):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("history", symbol, resolution, start, end, adjusted),
        60,
        provider.history,
        symbol,
        resolution,
        start,
        end,
        adjusted,
        stale_for=3600,
    )


@app.get("/v1/actions/{ticker}")
async def actions(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("actions", symbol), 3600, provider.actions, symbol, stale_for=86400
    )


@app.get("/v1/news/{ticker}")
async def news(ticker: str, limit: Annotated[int, Query(ge=1, le=30)] = 15):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("news", symbol, limit), 300, provider.news, symbol, limit, stale_for=3600
    )


@app.get("/v1/financials/{ticker}")
async def financials(
    ticker: str,
    statement: Literal["income", "balance", "cashFlow"] = "income",
    frequency: Literal["yearly", "quarterly"] = "yearly",
):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("financials", symbol, statement, frequency),
        3600,
        provider.financials,
        symbol,
        statement,
        frequency,
        stale_for=86400,
    )


@app.get("/v1/stats/{ticker}")
async def stats(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(("stats", symbol), 900, provider.stats, symbol, stale_for=86400)


@app.get("/v1/analysts/{ticker}")
async def analysts(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("analysts", symbol), 3600, provider.analysts, symbol, stale_for=86400
    )


@app.get("/v1/holders/{ticker}")
async def holders(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("holders", symbol), 21600, provider.holders, symbol, stale_for=172800
    )


@app.get("/v1/earnings/{ticker}")
async def earnings(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("earnings", symbol), 3600, provider.earnings, symbol, stale_for=86400
    )


@app.get("/v1/movers")
async def movers(
    list_name: Annotated[
        Literal["gainers", "losers", "actives"], Query(alias="list")
    ] = "gainers",
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
):
    return await lookup(
        ("movers", list_name, limit),
        120,
        provider.movers,
        list_name,
        limit,
        stale_for=3600,
    )


@app.get("/v1/people/{ticker}")
async def people(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("people", symbol), 86400, provider.people, symbol, stale_for=604800
    )


@app.get("/v1/peers/{ticker}")
async def peers(ticker: str):
    symbol = provider.ticker_value(ticker)
    return await lookup(
        ("peers", symbol), 86400, provider.peers, symbol, stale_for=604800
    )


@app.get("/v1/macro")
async def macro():
    return {"series": [provider.macro_metadata(series) for series in provider.MACRO]}


@app.get("/v1/macro/{series}")
async def macro_series(series: str, start: DateFrom = None, end: DateTo = None):
    series = series.upper()
    if series not in provider.MACRO:
        raise HTTPException(404, "Unknown macro series")
    if start and end and end < start:
        raise HTTPException(422, "End date precedes start date")
    return await lookup(
        ("macro", series, start, end),
        3600,
        provider.macro_series,
        series,
        start,
        end,
        stale_for=86400,
    )


class YahooSocket(yf.AsyncWebSocket):
    async def messages(self):
        # yfinance 1.2's listen loops again after a clean close. Expose the
        # iterator so the gateway owns reconnects and can report disconnects.
        async for raw in self._ws:
            envelope = json.loads(raw)
            if encoded := envelope.get("message"):
                yield self._decode_message(encoded)


def stream_quote(message):
    ticker = message.get("id", "").upper()
    ts = provider.timestamp(message.get("time"), unit=1000)
    last = provider.number(message.get("price"))
    if not ts or not provider.TICKER.fullmatch(ticker):
        return None
    fields = {
        "previousClose": message.get("previous_close"),
        "open": message.get("open_price"),
        "dayHigh": message.get("day_high"),
        "dayLow": message.get("day_low"),
        "volume": message.get("day_volume"),
        "bid": message.get("bid"),
        "ask": message.get("ask"),
    }
    if last is None and fields["bid"] is None and fields["ask"] is None:
        return None
    quote = provider.quote(ticker, last=last, ts=ts, source="ws", fields=fields)
    return {**quote, "provider": "yahoo", "currency": message.get("currency")}


@app.websocket("/internal/stream")
async def stream(websocket: WebSocket):
    await websocket.accept()
    upstream = YahooSocket(verbose=False)
    desired = {}

    async def update():
        payload = await websocket.receive_json()
        if not isinstance(payload, list) or not 0 < len(payload) <= MAX_SYMBOLS:
            raise ValueError("Invalid subscription set")
        next_symbols = {}
        for raw in payload:
            ticker = provider.ticker_value(raw)
            next_symbols.setdefault(provider.yahoo_symbol(ticker), []).append(ticker)
        if removed := desired.keys() - next_symbols.keys():
            await upstream.unsubscribe(sorted(removed))
        if added := next_symbols.keys() - desired.keys():
            await upstream.subscribe(sorted(added))
        desired.clear()
        desired.update(next_symbols)

    async def sync():
        while True:
            await update()

    async def forward():
        async for message in upstream.messages():
            quote = stream_quote(message)
            if quote and (aliases := desired.get(quote["ticker"])):
                quotes = [{**quote, "ticker": ticker} for ticker in aliases]
                await websocket.send_json({"type": "quotes", "quotes": quotes})

    tasks = set()
    try:
        await asyncio.wait_for(update(), timeout=10)
        await websocket.send_json({"type": "connected"})
        tasks = {asyncio.create_task(sync()), asyncio.create_task(forward())}
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    except Exception as error:  # noqa: BLE001 - close this stream on any upstream failure
        log.warning("Yahoo stream disconnected (%s)", type(error).__name__)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await upstream.close()
        try:
            await websocket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
