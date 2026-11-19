import { describe, expect, test } from "bun:test";
import { MarketDataClient } from "../../client";
import { isProviderUnavailable } from "../ports";
import { mergeDailyBars, YahooRelayProvider } from "./yahoo-relay";

const bar = (date: string, close: number) => ({
  ts: `${date}T00:00:00Z`,
  open: close,
  high: close,
  low: close,
  close,
  volume: 100,
});

function provider(respond: (url: URL) => Response | Promise<Response>) {
  return new YahooRelayProvider(
    new MarketDataClient({
      url: "https://relay.example",
      token: "t",
      fetch: async (url) => respond(url),
    }),
  );
}

describe("mergeDailyBars", () => {
  test("puts raw and adjusted prices and the day's action on one row", () => {
    const [first, second] = mergeDailyBars(
      [bar("2026-11-17", 100), bar("2026-11-18", 50)],
      [bar("2026-11-17", 49), bar("2026-11-18", 50)],
      [{ ticker: "ABC", date: "2026-11-18", divCash: 0, splitFactor: 2 }],
    );
    expect(first).toMatchObject({
      date: "2026-11-17",
      close: 100,
      adjClose: 49,
      divCash: 0,
      splitFactor: 1,
    });
    expect(second).toMatchObject({ date: "2026-11-18", splitFactor: 2 });
  });
});

describe("YahooRelayProvider", () => {
  test("a relay outage reads as unavailable, so caches serve stale", async () => {
    const relay = provider(() => Response.json({}, { status: 503 }));
    const error = await relay.getQuotes(["ABC"]).catch((caught) => caught);
    expect(isProviderUnavailable(error)).toBe(true);
  });

  test("a network failure reads as unavailable too", async () => {
    const relay = provider(() => {
      throw new TypeError("fetch failed");
    });
    const error = await relay.getQuotes(["ABC"]).catch((caught) => caught);
    expect(isProviderUnavailable(error)).toBe(true);
  });

  test("an unknown ticker is null, not an outage", async () => {
    const relay = provider(() =>
      Response.json({ detail: "Instrument not found" }, { status: 404 }),
    );
    expect(await relay.getSymbol("NOPE")).toBeNull();
  });

  test("a refused range is the caller's error, not an outage", async () => {
    const relay = provider(() =>
      Response.json({ detail: "Yahoo limits 1min history" }, { status: 422 }),
    );
    const error = await relay
      .getIntradayBars({
        ticker: "ABC",
        resolution: "1min",
        adjusted: false,
        from: "2020-01-01",
      })
      .catch((caught) => caught);
    expect(isProviderUnavailable(error)).toBe(false);
    expect(error.status).toBe(422);
  });
});
