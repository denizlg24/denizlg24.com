import { describe, expect, test } from "bun:test";
import type { Quote } from "@repo/schemas/markets";
import { changePercent, signedPercent, usd, widgetQuotes } from "./quotes";

const quote = (
  ticker: string,
  last: number | null,
  prevClose: number | null,
): Quote => ({
  ticker,
  last,
  prevClose,
  open: null,
  high: null,
  low: null,
  volume: null,
  bid: null,
  ask: null,
  ts: "2026-10-16T14:00:00.000Z",
  source: "cache",
});

describe("quotes", () => {
  test("change is relative to the previous close", () => {
    expect(changePercent(quote("A", 110, 100))).toBeCloseTo(10);
    expect(changePercent(quote("A", null, 100))).toBeNull();
    expect(changePercent(quote("A", 1, 0))).toBeNull();
  });

  test("the widget keeps the watchlist order and skips missing quotes", () => {
    expect(
      widgetQuotes(
        ["MSFT", "NOPE", "AAPL"],
        [quote("AAPL", 2, 1), quote("MSFT", 1, 2)],
      ).map((row) => row.symbol),
    ).toEqual(["MSFT", "AAPL"]);
  });

  test("signs and money read with a real minus", () => {
    expect(signedPercent(1.234)).toBe("+1.23%");
    expect(signedPercent(-0.5)).toBe("−0.50%");
    expect(signedPercent(null)).toBe("—");
    expect(usd(-1234.5)).toBe("−$1,234.50");
  });
});
