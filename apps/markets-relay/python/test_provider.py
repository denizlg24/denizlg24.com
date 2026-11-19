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
