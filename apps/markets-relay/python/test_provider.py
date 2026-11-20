import unittest
from datetime import date
from unittest.mock import patch

import pandas as pd
import provider
from worker import stream_quote


class ProviderTests(unittest.TestCase):
    def test_share_class_alias_preserves_international_symbols(self):
        self.assertEqual(provider.yahoo_symbol("BRK.B"), "BRK-B")
        self.assertEqual(provider.yahoo_symbol("VOD.L"), "VOD.L")
        self.assertEqual(provider.yahoo_symbol("NOVO-B.CO"), "NOVO-B.CO")

    def test_history_keeps_exchange_date_and_inclusive_bounds(self):
        row = [12.0, 13.0, 11.0, 12.5, 5100]
        frame = pd.DataFrame(
            [row],
            columns=["Open", "High", "Low", "Close", "Volume"],
            index=pd.DatetimeIndex(["2025-01-03"], tz="Asia/Tokyo"),
        )
        with patch.object(provider.yf, "Ticker") as ticker:
            history = ticker.return_value.history
            history.return_value = frame
            series = provider.history(
                "7203.T",
                "1day",
                date(2025, 1, 3),
                date(2025, 1, 3),
                False,
            )
        self.assertEqual(series["bars"][0]["ts"], "2025-01-03T00:00:00Z")
        self.assertEqual(history.call_args.kwargs["end"], "2025-01-04")
        self.assertFalse(history.call_args.kwargs["auto_adjust"])

    def test_quote_uses_yahoo_proto_field_names_and_wire_units(self):
        quote = stream_quote(
            {
                "id": "^GSPC",
                "time": "1738332000000",
                "price": 6100.5,
                "open_price": 6090.25,
                "previous_close": 6075,
                "day_volume": "4294967295",
            }
        )
        self.assertEqual(quote["ts"], "2025-01-31T14:00:00+00:00")
        self.assertEqual(quote["open"], 6090.25)
        self.assertEqual(quote["prevClose"], 6075)
        self.assertEqual(quote["volume"], 4294967295)
        self.assertEqual(quote["provider"], "yahoo")


class SecurityDataTests(unittest.TestCase):
    def test_fraction_and_iso_date(self):
        self.assertAlmostEqual(provider.fraction(0.31), 0.0031)
        self.assertIsNone(provider.fraction(float("nan")))
        self.assertEqual(provider.iso_date(1794441600), "2026-11-12")
        self.assertEqual(
            provider.iso_date(pd.Timestamp("2026-11-11 13:02")), "2026-11-11"
        )
        self.assertIsNone(provider.iso_date(None))

    def test_stats_normalises_dividend_percent_and_fallbacks(self):
        result = provider.stats_from_info(
            "AAPL",
            {
                "symbol": "AAPL",
                "currency": "USD",
                "dividendYield": 0.4,
                "fiveYearAvgDividendYield": 0.5,
                "payoutRatio": 0.12,
                "exDividendDate": 1794441600,
                "pegRatio": 2.5,
                "52WeekChange": 0.3,
                "priceToSalesTrailing12Months": 8.0,
            },
        )
        self.assertAlmostEqual(result["dividends"]["dividendYield"], 0.004)
        self.assertAlmostEqual(result["dividends"]["fiveYearAvgDividendYield"], 0.005)
        self.assertEqual(result["dividends"]["payoutRatio"], 0.12)
        self.assertEqual(result["dividends"]["exDividendDate"], "2026-11-12")
        self.assertEqual(result["valuation"]["pegRatio"], 2.5)
        self.assertEqual(result["valuation"]["priceToSales"], 8.0)
        self.assertEqual(result["trading"]["fiftyTwoWeekChange"], 0.3)
        self.assertIsNone(result["valuation"]["trailingPE"])
        self.assertIsNone(result["financialCurrency"])

    def test_rating_changes_newest_first_and_capped(self):
        frame = pd.DataFrame(
            {
                "Firm": ["A", "B", "C"],
                "ToGrade": ["Buy", "Hold", None],
                "FromGrade": ["Hold", "Hold", None],
                "Action": ["up", "main", "init"],
            },
            index=pd.DatetimeIndex(["2026-01-02", "2026-03-04", "2026-02-01"]),
        )
        changes = provider.rating_changes(frame, limit=2)
        self.assertEqual([row["firm"] for row in changes], ["B", "C"])
        self.assertEqual(changes[0]["date"], "2026-03-04")
        self.assertIsNone(changes[1]["toGrade"])
        self.assertEqual(provider.rating_changes(pd.DataFrame()), [])

    def test_holder_and_insider_rows(self):
        funds = pd.DataFrame(
            {
                "Date Reported": pd.to_datetime(["2026-09-30"]),
                "Holder": ["Vanguard"],
                "pctHeld": [0.07],
                "Shares": [100],
                "Value": [2000],
                "pctChange": [-0.01],
            }
        )
        self.assertEqual(
            provider.holder_rows(funds),
            [
                {
                    "holder": "Vanguard",
                    "shares": 100.0,
                    "value": 2000.0,
                    "percentHeld": 0.07,
                    "change": -0.01,
                    "reportedAt": "2026-09-30",
                }
            ],
        )
        insiders = pd.DataFrame(
            {
                "Insider": ["X", "Y"],
                "Position": ["Director", "Officer"],
                "Transaction": ["", "Sale"],
                "Text": ["Stock Gift", "Sale at price 1"],
                "Shares": [5, 6],
                "Value": [float("nan"), 60.0],
                "Start Date": pd.to_datetime(["2026-11-01", "2026-11-09"]),
            }
        )
        rows = provider.insider_rows(insiders)
        self.assertEqual([row["name"] for row in rows], ["Y", "X"])
        self.assertEqual(rows[1]["transaction"], "Stock Gift")
        self.assertIsNone(rows[1]["value"])

    def test_holder_breakdown(self):
        frame = pd.DataFrame(
            {"Value": [0.02, 0.66, 0.68, 7000.0]},
            index=[
                "insidersPercentHeld",
                "institutionsPercentHeld",
                "institutionsFloatPercentHeld",
                "institutionsCount",
            ],
        )
        self.assertEqual(
            provider.holder_breakdown(frame),
            {
                "insidersPercent": 0.02,
                "institutionsPercent": 0.66,
                "institutionsFloatPercent": 0.68,
                "institutionsCount": 7000,
            },
        )
        self.assertIsNone(provider.holder_breakdown(None)["insidersPercent"])

    def test_earnings_history_and_next(self):
        frame = pd.DataFrame(
            {
                "EPS Estimate": [2.9, 1.98, 1.89],
                "Reported EPS": [float("nan"), 2.1, 2.02],
                "Surprise(%)": [float("nan"), 5.8, 6.74],
            },
            index=pd.DatetimeIndex(
                ["2027-01-28 16:00", "2026-11-02 16:00", "2026-07-30 16:00"],
                tz="America/New_York",
            ),
        )
        history, upcoming = provider.earnings_history(frame, date(2026, 11, 20))
        self.assertEqual([row["date"] for row in history], ["2026-11-02", "2026-07-30"])
        self.assertAlmostEqual(history[0]["surprisePercent"], 0.058)
        self.assertEqual(upcoming, (date(2027, 1, 28), 2.9))
        fallback = provider.earnings_next({}, upcoming)
        self.assertEqual(fallback["date"], "2027-01-28")
        self.assertEqual(fallback["epsEstimate"], 2.9)
        calendar = {
            "Earnings Date": [date(2027, 1, 29)],
            "Earnings Average": 3.0,
            "Revenue High": 10,
        }
        self.assertEqual(provider.earnings_next(calendar, upcoming)["epsEstimate"], 3.0)
        self.assertIsNone(provider.earnings_next({}, None))

    def test_mover_rows_skip_bad_tickers_and_keep_percent_units(self):
        rows = provider.mover_rows(
            [
                {
                    "symbol": "ins",
                    "shortName": "Insmed",
                    "regularMarketPrice": 145.0,
                    "regularMarketChange": 24.7,
                    "regularMarketChangePercent": 20.58,
                    "fullExchangeName": "NasdaqGS",
                },
                {"symbol": "bad symbol!"},
                {},
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["ticker"], "INS")
        self.assertEqual(rows[0]["percent"], 20.58)
        self.assertEqual(rows[0]["exchange"], "NasdaqGS")
        self.assertIsNone(rows[0]["volume"])

    def test_settled_fails_only_when_everything_fails(self):
        def boom():
            raise RuntimeError("down")

        self.assertEqual(provider.settled(boom, lambda: 1), [None, 1])
        with self.assertRaises(RuntimeError):
            provider.settled(boom, boom)


class PeopleAndPeersTests(unittest.TestCase):
    def test_people_maps_officers_and_governance(self):
        officers = [
            {
                "name": f"Exec {n}",
                "title": "CEO",
                "age": 63,
                "yearBorn": 1962,
                "totalPay": 8271898,
            }
            for n in range(20)
        ]
        officers.insert(1, {"title": "Nameless"})
        officers.insert(2, {"name": "Young", "age": None, "totalPay": float("nan")})
        result = provider.people_from_info(
            "GM", {"companyOfficers": officers, "auditRisk": 4, "overallRisk": 6}
        )
        self.assertEqual(len(result["officers"]), 15)
        self.assertEqual(result["officers"][0]["born"], 1962)
        self.assertEqual(result["officers"][1]["name"], "Young")
        self.assertIsNone(result["officers"][1]["age"])
        self.assertIsNone(result["officers"][1]["totalPay"])
        self.assertEqual(result["governance"]["auditRisk"], 4.0)
        self.assertIsNone(result["governance"]["boardRisk"])
        self.assertEqual(provider.people_from_info("X", {})["officers"], [])

    def test_peer_rows_validate_dedupe_and_cap(self):
        payload = {
            "finance": {
                "result": [
                    {
                        "recommendedSymbols": [
                            {"symbol": "f", "score": 0.22},
                            {"symbol": "F", "score": 0.1},
                            {"symbol": "bad symbol", "score": 1},
                            {"symbol": "BA"},
                        ]
                        + [{"symbol": f"T{n}", "score": 0.01} for n in range(20)]
                    }
                ]
            }
        }
        rows = provider.peer_rows(payload)
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows[0], {"ticker": "F", "score": 0.22})
        self.assertIsNone(rows[1]["score"])
        self.assertEqual(provider.peer_rows(None), [])
        self.assertEqual(provider.peer_rows({"finance": {"result": None}}), [])
