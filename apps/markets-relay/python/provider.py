import csv
import io
import math
import re
from datetime import UTC, date, datetime, timedelta
from urllib.parse import urlencode
from urllib.request import urlopen

import yfinance as yf
from fastapi import HTTPException
from yfinance.data import YfData
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


def fraction(value):
    result = number(value)
    return None if result is None else result / 100


def iso_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10]).isoformat()
        except ValueError:
            return None
    seconds = timestamp(value)
    return seconds[:10] if seconds else None


def text(value):
    return value.strip() or None if isinstance(value, str) else None


def integer(value):
    result = number(value)
    return None if result is None else int(result)


def freshness():
    return {"source": "yahoo", "fetchedAt": now_iso(), "stale": False}


def attempt(load):
    """Run one sub-source; (None, error) lets siblings still answer."""
    try:
        return load(), None
    except Exception as error:  # noqa: BLE001 - each part degrades independently
        return None, error


def settled(*loads):
    outcomes = [attempt(load) for load in loads]
    if all(error for _, error in outcomes):
        raise outcomes[0][1]
    return [value for value, _ in outcomes]


def pick(source, mapping, convert=number):
    return {name: convert(source.get(key)) for name, key in mapping.items()}


STATS_SECTIONS = {
    "valuation": {
        "marketCap": "marketCap",
        "enterpriseValue": "enterpriseValue",
        "trailingPE": "trailingPE",
        "forwardPE": "forwardPE",
        "pegRatio": "trailingPegRatio",
        "priceToBook": "priceToBook",
        "priceToSales": "priceToSalesTrailing12Months",
        "evToEbitda": "enterpriseToEbitda",
        "evToRevenue": "enterpriseToRevenue",
    },
    "profitability": {
        "grossMargin": "grossMargins",
        "operatingMargin": "operatingMargins",
        "profitMargin": "profitMargins",
        "returnOnEquity": "returnOnEquity",
        "returnOnAssets": "returnOnAssets",
        "revenueGrowth": "revenueGrowth",
        "earningsGrowth": "earningsGrowth",
    },
    "trading": {
        "beta": "beta",
        "fiftyTwoWeekHigh": "fiftyTwoWeekHigh",
        "fiftyTwoWeekLow": "fiftyTwoWeekLow",
        "fiftyTwoWeekChange": "fiftyTwoWeekChange",
        "fiftyDayAverage": "fiftyDayAverage",
        "twoHundredDayAverage": "twoHundredDayAverage",
        "averageVolume": "averageVolume",
        "averageVolume10d": "averageVolume10days",
        "sharesOutstanding": "sharesOutstanding",
        "floatShares": "floatShares",
        "sharesShort": "sharesShort",
        "shortRatio": "shortRatio",
        "shortPercentOfFloat": "shortPercentOfFloat",
        "heldPercentInsiders": "heldPercentInsiders",
        "heldPercentInstitutions": "heldPercentInstitutions",
    },
    "fundamentals": {
        "totalRevenue": "totalRevenue",
        "ebitda": "ebitda",
        "netIncome": "netIncomeToCommon",
        "freeCashflow": "freeCashflow",
        "operatingCashflow": "operatingCashflow",
        "totalCash": "totalCash",
        "totalDebt": "totalDebt",
        "debtToEquity": "debtToEquity",
        "currentRatio": "currentRatio",
        "quickRatio": "quickRatio",
        "trailingEps": "trailingEps",
        "forwardEps": "forwardEps",
        "bookValue": "bookValue",
    },
}


def stats_from_info(ticker, info):
    sections = {name: pick(info, mapping) for name, mapping in STATS_SECTIONS.items()}
    if sections["valuation"]["pegRatio"] is None:
        sections["valuation"]["pegRatio"] = number(info.get("pegRatio"))
    # Many symbols only carry the 52-week change under Yahoo's legacy key.
    if sections["trading"]["fiftyTwoWeekChange"] is None:
        sections["trading"]["fiftyTwoWeekChange"] = number(info.get("52WeekChange"))
    # yfinance 1.x reports dividend yields in percent units, unlike every other ratio.
    sections["dividends"] = {
        "dividendRate": number(info.get("dividendRate")),
        "dividendYield": fraction(info.get("dividendYield")),
        "payoutRatio": number(info.get("payoutRatio")),
        "exDividendDate": iso_date(info.get("exDividendDate")),
        "fiveYearAvgDividendYield": fraction(info.get("fiveYearAvgDividendYield")),
    }
    return {
        "ticker": ticker,
        "currency": text(info.get("currency")),
        "financialCurrency": text(info.get("financialCurrency")),
        **sections,
        "freshness": freshness(),
    }


def stats(ticker):
    info = yf.Ticker(yahoo_symbol(ticker)).get_info()
    if not info.get("symbol"):
        raise HTTPException(404, "Instrument not found")
    return stats_from_info(ticker, info)


def frame_records(frame):
    if frame is None or not hasattr(frame, "iterrows") or frame.empty:
        return []
    return [row.to_dict() for _, row in frame.iterrows()]


def trend_rows(frame):
    return [
        {
            "period": text(row.get("period")) or "",
            **{
                key: integer(row.get(key)) or 0
                for key in ("strongBuy", "buy", "hold", "sell", "strongSell")
            },
        }
        for row in frame_records(frame)
    ]


def rating_changes(frame, limit=25):
    changes = []
    if frame is None or not hasattr(frame, "iterrows") or frame.empty:
        return changes
    for graded, row in frame.sort_index(ascending=False).iterrows():
        day = iso_date(graded)
        if day is None:
            continue
        changes.append(
            {
                "date": day,
                "firm": text(row.get("Firm")),
                "toGrade": text(row.get("ToGrade")),
                "fromGrade": text(row.get("FromGrade")),
                "action": text(row.get("Action")),
            }
        )
    return changes[:limit]


def analysts(ticker):
    stock = yf.Ticker(yahoo_symbol(ticker))
    info, targets, trend, changes = settled(
        stock.get_info,
        stock.get_analyst_price_targets,
        stock.get_recommendations,
        stock.get_upgrades_downgrades,
    )
    info = info or {}
    targets = targets if isinstance(targets, dict) else {}
    return {
        "ticker": ticker,
        "recommendation": {
            "key": text(info.get("recommendationKey")),
            "mean": number(info.get("recommendationMean")),
            "analysts": integer(info.get("numberOfAnalystOpinions")),
        },
        "targets": pick(
            targets, {key: key for key in ("current", "low", "high", "mean", "median")}
        ),
        "trend": trend_rows(trend),
        "changes": rating_changes(changes),
        "freshness": freshness(),
    }


def holder_rows(frame, limit=15):
    rows = []
    for row in frame_records(frame):
        holder = text(row.get("Holder"))
        if holder is None:
            continue
        rows.append(
            {
                "holder": holder,
                "shares": number(row.get("Shares")),
                "value": number(row.get("Value")),
                "percentHeld": number(row.get("pctHeld")),
                "change": number(row.get("pctChange")),
                "reportedAt": iso_date(row.get("Date Reported")),
            }
        )
    return rows[:limit]


def insider_rows(frame, limit=20):
    rows = []
    for row in frame_records(frame):
        rows.append(
            {
                "name": text(row.get("Insider")),
                "relation": text(row.get("Position")),
                "transaction": text(row.get("Transaction")) or text(row.get("Text")),
                "shares": number(row.get("Shares")),
                "value": number(row.get("Value")),
                "date": iso_date(row.get("Start Date")),
            }
        )
    rows.sort(key=lambda row: row["date"] or "", reverse=True)
    return rows[:limit]


def holder_breakdown(frame):
    values = {}
    if frame is not None and hasattr(frame, "iterrows"):
        values = {str(key): row.get("Value") for key, row in frame.iterrows()}
    return {
        "insidersPercent": number(values.get("insidersPercentHeld")),
        "institutionsPercent": number(values.get("institutionsPercentHeld")),
        "institutionsFloatPercent": number(values.get("institutionsFloatPercentHeld")),
        "institutionsCount": integer(values.get("institutionsCount")),
    }


def holders(ticker):
    stock = yf.Ticker(yahoo_symbol(ticker))
    major, institutions, funds, insiders = settled(
        stock.get_major_holders,
        stock.get_institutional_holders,
        stock.get_mutualfund_holders,
        stock.get_insider_transactions,
    )
    return {
        "ticker": ticker,
        "breakdown": holder_breakdown(major),
        "institutions": holder_rows(institutions),
        "funds": holder_rows(funds),
        "insiders": insider_rows(insiders),
        "freshness": freshness(),
    }


def earnings_history(frame, today, limit=12):
    history = []
    upcoming = None
    if frame is None or not hasattr(frame, "iterrows") or frame.empty:
        return history, upcoming
    for stamp, row in frame.iterrows():
        day = stamp.date()
        actual = number(row.get("Reported EPS"))
        if actual is None:
            if day >= today and (upcoming is None or day < upcoming[0]):
                upcoming = (day, number(row.get("EPS Estimate")))
            continue
        history.append(
            {
                "date": day.isoformat(),
                "epsEstimate": number(row.get("EPS Estimate")),
                "epsActual": actual,
                "surprisePercent": fraction(row.get("Surprise(%)")),
            }
        )
    history.sort(key=lambda row: row["date"], reverse=True)
    return history[:limit], upcoming


def earnings_next(calendar, upcoming):
    calendar = calendar if isinstance(calendar, dict) else {}
    dates = calendar.get("Earnings Date")
    dates = dates if isinstance(dates, (list, tuple)) else [dates]
    days = sorted(day for day in map(iso_date, dates) if day)
    day = days[0] if days else (upcoming[0].isoformat() if upcoming else None)
    if day is None:
        return None
    estimate = number(calendar.get("Earnings Average"))
    return {
        "date": day,
        "epsEstimate": estimate
        if estimate is not None
        else (upcoming[1] if upcoming else None),
        "epsLow": number(calendar.get("Earnings Low")),
        "epsHigh": number(calendar.get("Earnings High")),
        "revenueEstimate": number(calendar.get("Revenue Average")),
        "revenueLow": number(calendar.get("Revenue Low")),
        "revenueHigh": number(calendar.get("Revenue High")),
    }


def earnings(ticker):
    stock = yf.Ticker(yahoo_symbol(ticker))
    calendar, dates = settled(
        stock.get_calendar, lambda: stock.get_earnings_dates(limit=16)
    )
    history, upcoming = earnings_history(dates, datetime.now(UTC).date())
    return {
        "ticker": ticker,
        "next": earnings_next(calendar, upcoming),
        "history": history,
        "freshness": freshness(),
    }


SCREENS = {
    "gainers": "day_gainers",
    "losers": "day_losers",
    "actives": "most_actives",
}


def mover_rows(rows):
    movers = []
    for row in rows:
        ticker = str(row.get("symbol") or "").upper()
        if not TICKER.fullmatch(ticker):
            continue
        movers.append(
            {
                "ticker": ticker,
                "name": text(row.get("shortName"))
                or text(row.get("longName"))
                or ticker,
                "last": number(row.get("regularMarketPrice")),
                "change": number(row.get("regularMarketChange")),
                "percent": number(row.get("regularMarketChangePercent")),
                "volume": number(row.get("regularMarketVolume"), nonnegative=True),
                "averageVolume": number(
                    row.get("averageDailyVolume3Month"), nonnegative=True
                ),
                "marketCap": number(row.get("marketCap"), nonnegative=True),
                "currency": text(row.get("currency")),
                "exchange": text(row.get("fullExchangeName"))
                or text(row.get("exchange")),
            }
        )
    return movers


def movers(list_name, limit):
    result = yf.screen(SCREENS[list_name], count=limit)
    return {
        "list": list_name,
        "quotes": mover_rows(result.get("quotes", []))[:limit],
        "freshness": freshness(),
    }


GOVERNANCE_FIELDS = (
    "auditRisk",
    "boardRisk",
    "compensationRisk",
    "shareHolderRightsRisk",
    "overallRisk",
)


def officer_rows(officers, limit=15):
    rows = []
    for officer in officers if isinstance(officers, list) else []:
        name = text(officer.get("name")) if isinstance(officer, dict) else None
        if name is None:
            continue
        rows.append(
            {
                "name": name,
                "title": text(officer.get("title")),
                "age": integer(officer.get("age")),
                "born": integer(officer.get("yearBorn")),
                "totalPay": number(officer.get("totalPay")),
            }
        )
    return rows[:limit]


def people_from_info(ticker, info):
    return {
        "ticker": ticker,
        "officers": officer_rows(info.get("companyOfficers")),
        "governance": pick(info, {key: key for key in GOVERNANCE_FIELDS}),
        "freshness": freshness(),
    }


def people(ticker):
    info = yf.Ticker(yahoo_symbol(ticker)).get_info()
    if not info.get("symbol"):
        raise HTTPException(404, "Instrument not found")
    return people_from_info(ticker, info)


def peer_rows(payload, limit=12):
    peers = {}
    results = ((payload or {}).get("finance") or {}).get("result") or []
    for result in results:
        for row in result.get("recommendedSymbols") or []:
            peer = str(row.get("symbol") or "").upper()
            if TICKER.fullmatch(peer) and peer not in peers:
                peers[peer] = {"ticker": peer, "score": number(row.get("score"))}
    return list(peers.values())[:limit]


def peers(ticker):
    symbol = yahoo_symbol(ticker)
    info, _ = attempt(yf.Ticker(symbol).get_info)
    similar, error = attempt(
        lambda: YfData().get_raw_json(
            f"https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/{symbol}"
        )
    )
    if info is None and error:
        raise error
    info = info or {}
    return {
        "ticker": ticker,
        "sector": text(info.get("sector")),
        "industry": text(info.get("industry")),
        "peers": peer_rows(similar),
        "freshness": freshness(),
    }
