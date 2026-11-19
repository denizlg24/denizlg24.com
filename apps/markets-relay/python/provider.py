import csv
import io
import math
import re
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlencode
from urllib.request import urlopen

import yfinance as yf
from fastapi import HTTPException
from yfinance.exceptions import YFPricesMissingError

TICKER = re.compile(r"(?=.*[A-Z0-9])[A-Z0-9.^=:-]{1,24}")
ASSET_TYPES = {
    "EQUITY": "stock",
    "ETF": "etf",
    "MUTUALFUND": "mutualFund",
    "INDEX": "index",
    "CRYPTOCURRENCY": "crypto",
    "CURRENCY": "fx",
    "FUTURE": "future",
    "OPTION": "option",
    "BOND": "bond",
}
INTERVALS = {
    "1min": ("1m", 7),
    "5min": ("5m", 60),
    "15min": ("15m", 60),
    "30min": ("30m", 60),
    "1hour": ("1h", 730),
    "1day": ("1d", None),
    "1week": ("1wk", None),
    "1month": ("1mo", None),
}
MACRO = {
    "CPIAUCSL": ("Consumer Price Index (U.S.)", "Index 1982–84=100", "monthly"),
    "PCEPI": (
        "Personal Consumption Expenditures Price Index (U.S.)",
        "Index 2017=100",
        "monthly",
    ),
    "UNRATE": ("Unemployment Rate (U.S.)", "Percent", "monthly"),
    "PAYEMS": ("Nonfarm Payrolls (U.S.)", "Thousands of persons", "monthly"),
    "GDPC1": ("Real GDP (U.S.)", "Billions of chained 2017 dollars", "quarterly"),
    "DFF": ("Effective Federal Funds Rate", "Percent", "daily"),
    "DGS2": ("2-Year Treasury Yield", "Percent", "daily"),
    "DGS10": ("10-Year Treasury Yield", "Percent", "daily"),
    "T10Y2Y": ("10-Year Minus 2-Year Treasury Yield", "Percentage points", "daily"),
    "M2SL": ("M2 Money Stock (U.S.)", "Billions of dollars", "monthly"),
    "ECBDFR": ("ECB Deposit Facility Rate", "Percent", "daily"),
}

# Let upstream failures reach the API so they cannot become cached empty results.
yf.config.debug.hide_exceptions = False


def now_iso():
    return datetime.now(UTC).isoformat()


def ticker_value(value):
    ticker = value.strip().upper()
    if not TICKER.fullmatch(ticker):
        raise HTTPException(422, "Invalid ticker")
    return ticker


def number(value, *, nonnegative=False):
    try:
        value = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(value) or (nonnegative and value < 0):
        return None
    return value


def timestamp(value, unit=1):
    seconds = number(value, nonnegative=True)
    if not seconds:
        return None
    try:
        return datetime.fromtimestamp(seconds / unit, UTC).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def search(query, limit):
    rows = yf.Search(
        query,
        max_results=limit,
        news_count=0,
        lists_count=0,
        include_cb=False,
        enable_fuzzy_query=True,
        timeout=8,
    ).quotes
    results = {}
    for row in rows:
        ticker = row.get("symbol", "").upper()
        if not TICKER.fullmatch(ticker) or ticker in results:
            continue
        results[ticker] = {
            "ticker": ticker,
            "name": row.get("longname") or row.get("shortname") or ticker,
            "exchange": row.get("exchDisp") or row.get("exchange") or "",
            "assetType": ASSET_TYPES.get(row.get("quoteType"), "other"),
            "score": number(row.get("score")) or 0,
        }
    return {"results": list(results.values())[:limit]}


SHARE_CLASS = re.compile(r"[A-Z]{1,5}\.[AB]")


def yahoo_symbol(ticker):
    return ticker.replace(".", "-") if SHARE_CLASS.fullmatch(ticker) else ticker


def quote(ticker, *, last, ts, source, fields):
    return {
        "ticker": ticker,
        "last": last,
        "ts": ts,
        "source": source,
        "prevClose": number(fields.get("previousClose")),
        "open": number(fields.get("open")),
        "high": number(fields.get("dayHigh")),
        "low": number(fields.get("dayLow")),
        "volume": number(fields.get("volume"), nonnegative=True),
        "bid": number(fields.get("bid")),
        "ask": number(fields.get("ask")),
    }


def snapshot(ticker):
    stock = yf.Ticker(yahoo_symbol(ticker))
    try:
        frame = stock.history(period="5d", auto_adjust=False, actions=False, timeout=8)
    except YFPricesMissingError:
        return None
    if frame.empty:
        return None
    meta = stock.get_history_metadata()
    row = frame.iloc[-1]
    ts = timestamp(meta.get("regularMarketTime"))
    last = number(meta.get("regularMarketPrice"))
    realtime = ts is not None and last is not None
    previous = number(meta.get("previousClose"))
    if previous is None and len(frame) > 1:
        previous = number(frame.iloc[-2]["Close"])
    fields = {
        "previousClose": previous,
        "open": row["Open"],
        "dayHigh": row["High"],
        "dayLow": row["Low"],
        "volume": row["Volume"],
    }
    result = quote(
        ticker,
        last=last if realtime else number(row["Close"]),
        ts=ts if realtime else frame.index[-1].isoformat(),
        source="yahoo" if realtime else "eod",
        fields=fields,
    )
    return {**result, "currency": meta.get("currency"), "provider": "yahoo"}


def instrument(ticker):
    info = yf.Ticker(yahoo_symbol(ticker)).get_info()
    if not info.get("symbol"):
        raise HTTPException(404, "Instrument not found")
    name = info.get("longName") or info.get("shortName") or ticker
    fetched = now_iso()
    symbol = {
        "ticker": ticker,
        "name": name,
        "exchange": info.get("fullExchangeName"),
        "currency": info.get("currency"),
        "assetType": ASSET_TYPES.get(info.get("quoteType"), "other"),
        "updatedAt": fetched,
        "active": True,
    }
    profile = {
        "ticker": ticker,
        "name": name,
        "updatedAt": fetched,
        "description": info.get("longBusinessSummary"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "country": info.get("country"),
        "website": info.get("website"),
        "employees": info.get("fullTimeEmployees"),
        "marketCap": info.get("marketCap"),
        "sharesOutstanding": info.get("sharesOutstanding"),
    }
    return {
        "symbol": {key: value for key, value in symbol.items() if value is not None},
        "profile": {key: value for key, value in profile.items() if value is not None},
        "stale": False,
    }


def history(ticker, resolution, start, end, adjusted):
    interval, lookback = INTERVALS[resolution]
    args = {
        "interval": interval,
        "auto_adjust": adjusted,
        "actions": False,
        "timeout": 8,
    }
    if end and start and end < start:
        raise HTTPException(422, "End date precedes start date")
    if lookback:
        today = datetime.now(UTC).date()
        earliest = today - timedelta(days=lookback - 1)
        if (start and start < earliest) or (end and end < earliest):
            raise HTTPException(
                422, f"Yahoo limits {resolution} history to the last {lookback} days"
            )
        start = start or earliest
    if start:
        args["start"] = start.isoformat()
    if end:
        if end == date.max:
            raise HTTPException(422, "End date is too large")
        args["end"] = (end + timedelta(days=1)).isoformat()
    if not start:
        args["period"] = "max"
    try:
        frame = yf.Ticker(yahoo_symbol(ticker)).history(**args)
    except YFPricesMissingError as error:
        if "no price data found" not in str(error):
            raise
        return {
            "ticker": ticker,
            "resolution": resolution,
            "adjusted": adjusted,
            "bars": [],
            "freshness": {"source": "yahoo", "fetchedAt": now_iso(), "stale": False},
        }

    bars = []
    for row in frame.itertuples():
        prices = [number(value) for value in (row.Open, row.High, row.Low, row.Close)]
        if None in prices:
            continue
        ts = (
            row.Index.tz_convert("UTC").isoformat()
            if lookback
            else row.Index.date().isoformat() + "T00:00:00Z"
        )
        bars.append(
            dict(
                zip(("open", "high", "low", "close"), prices),
                ts=ts,
                volume=number(row.Volume, nonnegative=True) or 0,
            )
        )
    return {
        "ticker": ticker,
        "resolution": resolution,
        "adjusted": adjusted,
        "bars": bars,
        "freshness": {"source": "yahoo", "fetchedAt": now_iso(), "stale": False},
    }


def actions(ticker):
    frame = yf.Ticker(yahoo_symbol(ticker)).history(
        period="max",
        auto_adjust=False,
        actions=True,
        timeout=8,
    )
    frame = frame.reindex(columns=["Dividends", "Stock Splits"])
    events = []
    for row in frame.itertuples(name=None):
        ts, dividend_raw, split_raw = row
        dividend = number(dividend_raw) or 0
        split = number(split_raw, nonnegative=True) or 1
        if dividend or split != 1:
            events.append(
                {
                    "ticker": ticker,
                    "date": ts.date().isoformat(),
                    "divCash": dividend,
                    "splitFactor": split,
                }
            )
    return {"actions": events, "stale": False}


def macro_metadata(series):
    name, units, frequency = MACRO[series]
    return {
        "id": series,
        "name": name,
        "units": units,
        "frequency": frequency,
        "source": "fred",
        "url": f"https://fred.stlouisfed.org/series/{series}",
    }


def macro_series(series, start, end):
    params = {"id": series}
    if start:
        params["cosd"] = start.isoformat()
    if end:
        params["coed"] = end.isoformat()
    url = "https://fred.stlouisfed.org/graph/fredgraph.csv?" + urlencode(params)
    with urlopen(url, timeout=8) as response:
        rows = csv.DictReader(io.TextIOWrapper(response, encoding="utf-8-sig"))
        if (
            not rows.fieldnames
            or series not in rows.fieldnames
            or "observation_date" not in rows.fieldnames
        ):
            raise ValueError("Unexpected FRED CSV columns")
        observations = []
        for row in rows:
            day = date.fromisoformat(row["observation_date"])
            value = number(row[series])
            if (
                value is not None
                and (start is None or day >= start)
                and (end is None or day <= end)
            ):
                observations.append({"date": day.isoformat(), "value": value})
    return {
        "series": macro_metadata(series),
        "observations": observations,
        "freshness": {"source": "fred", "fetchedAt": now_iso(), "stale": False},
    }


def news(ticker, limit):
    stories = yf.Search(
        yahoo_symbol(ticker),
        max_results=1,
        news_count=limit,
        lists_count=0,
        include_cb=False,
        timeout=8,
    ).news
    articles = {}
    for story in stories:
        identifier = story.get("uuid")
        headline = story.get("title")
        published = timestamp(story.get("providerPublishTime"))
        url = story.get("link")
        if (
            not identifier
            or not headline
            or not published
            or not url
            or not url.startswith(("https://", "http://"))
        ):
            continue
        article = {
            "id": identifier,
            "ticker": ticker,
            "headline": headline,
            "url": url,
            "publishedAt": published,
        }
        if publisher := story.get("publisher"):
            article["source"] = publisher
        articles[identifier] = article
    return {
        "news": sorted(
            articles.values(), key=lambda article: article["publishedAt"], reverse=True
        )[:limit],
        "stale": False,
    }


def financials(ticker, statement, frequency):
    stock = yf.Ticker(yahoo_symbol(ticker))
    getters = {
        "income": stock.get_income_stmt,
        "balance": stock.get_balance_sheet,
        "cashFlow": stock.get_cash_flow,
    }
    frame = getters[statement](freq=frequency)
    periods = []
    for period, column in frame.items():
        if not hasattr(period, "date"):
            continue
        values = {}
        for label, raw in column.items():
            amount = number(raw)
            if amount is not None:
                values[label] = amount
        if values:
            periods.append({"date": period.date().isoformat(), "values": values})
    return {
        "ticker": ticker,
        "statement": statement,
        "frequency": frequency,
        "periods": sorted(periods, key=lambda period: period["date"], reverse=True),
        "freshness": {"source": "yahoo", "fetchedAt": now_iso(), "stale": False},
    }
