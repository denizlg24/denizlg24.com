import { describe, expect, test } from "bun:test";
import { createFinanceFxConverter, FrankfurterFxProvider } from "./fx";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("FrankfurterFxProvider", () => {
  test("requests the base and symbols, and returns the rate table", async () => {
    const seen: string[] = [];
    const provider = new FrankfurterFxProvider({
      baseUrl: "https://fx.test/v1",
      fetchImpl: async (input) => {
        seen.push(String(input));
        return jsonResponse({
          amount: 1,
          base: "EUR",
          date: "2026-07-29",
          rates: { USD: 1.08, GBP: 0.85 },
        });
      },
    });

    const result = await provider.fetchLatest("EUR", ["USD", "GBP"]);

    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!);
    expect(url.pathname).toBe("/v1/latest");
    expect(url.searchParams.get("base")).toBe("EUR");
    expect(url.searchParams.get("symbols")).toBe("USD,GBP");
    expect(result).toEqual({
      date: "2026-07-29",
      rates: { USD: 1.08, GBP: 0.85 },
    });
  });

  test("drops the base from the requested symbols", async () => {
    const requested: Array<string | null> = [];
    const provider = new FrankfurterFxProvider({
      baseUrl: "https://fx.test/v1",
      fetchImpl: async (input) => {
        requested.push(new URL(String(input)).searchParams.get("symbols"));
        return jsonResponse({
          amount: 1,
          base: "EUR",
          date: "2026-07-29",
          rates: { USD: 1.08 },
        });
      },
    });

    await provider.fetchLatest("EUR", ["EUR", "USD"]);
    expect(requested).toEqual(["USD"]);
  });

  test("skips the network entirely when only the base is wanted", async () => {
    let called = false;
    const provider = new FrankfurterFxProvider({
      baseUrl: "https://fx.test/v1",
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });

    const result = await provider.fetchLatest("EUR", ["EUR"]);
    expect(called).toBe(false);
    expect(result.rates).toEqual({});
  });

  test("throws on a non-2xx response", async () => {
    const provider = new FrankfurterFxProvider({
      baseUrl: "https://fx.test/v1",
      fetchImpl: async () => jsonResponse({ error: "nope" }, 503),
    });

    await expect(provider.fetchLatest("EUR", ["USD"])).rejects.toThrow(
      "HTTP 503",
    );
  });

  test("throws when the payload does not match the expected shape", async () => {
    const provider = new FrankfurterFxProvider({
      baseUrl: "https://fx.test/v1",
      fetchImpl: async () =>
        jsonResponse({ base: "EUR", date: "29-07-2026", rates: {} }),
    });

    await expect(provider.fetchLatest("EUR", ["USD"])).rejects.toThrow(
      "unexpected payload",
    );
  });

  test("rejects a non-positive rate rather than storing it", async () => {
    const provider = new FrankfurterFxProvider({
      baseUrl: "https://fx.test/v1",
      fetchImpl: async () =>
        jsonResponse({
          amount: 1,
          base: "EUR",
          date: "2026-07-29",
          rates: { USD: 0 },
        }),
    });

    await expect(provider.fetchLatest("EUR", ["USD"])).rejects.toThrow(
      "unexpected payload",
    );
  });
});

describe("createFinanceFxConverter", () => {
  // Base is EUR, as the pinned dashboard currency would be.
  const snapshots = [
    {
      date: "2026-07-29",
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      rateMicros: 1_080_000,
    },
    {
      date: "2026-07-29",
      baseCurrency: "EUR",
      quoteCurrency: "GBP",
      rateMicros: 850_000,
    },
    {
      date: "2026-07-01",
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      rateMicros: 1_200_000,
    },
  ];

  test("returns the amount unchanged for a same-currency pair", () => {
    const fx = createFinanceFxConverter(snapshots);
    expect(fx.convert(1_234, "EUR", "EUR")).toBe(1_234);
  });

  // The case that broke matching: a USD subscription posting to a euro account.
  test("converts a quote amount into the base currency", () => {
    const fx = createFinanceFxConverter(snapshots);
    expect(fx.convert(2_460, "USD", "EUR", "2026-07-29")).toBe(2_278);
  });

  test("converts the base currency out to a quote", () => {
    const fx = createFinanceFxConverter(snapshots);
    expect(fx.convert(10_000, "EUR", "USD", "2026-07-29")).toBe(10_800);
  });

  test("pivots through the base for a pair with no direct rate", () => {
    const fx = createFinanceFxConverter(snapshots);
    // USD → EUR → GBP: 108.00 USD is 100 EUR is 85 GBP.
    expect(fx.convert(10_800, "USD", "GBP", "2026-07-29")).toBe(8_500);
  });

  test("uses the most recent rate on or before the requested date", () => {
    const fx = createFinanceFxConverter(snapshots);
    expect(fx.convert(12_000, "USD", "EUR", "2026-07-15")).toBe(10_000);
  });

  test("returns undefined when no rate applies rather than guessing", () => {
    const fx = createFinanceFxConverter(snapshots);
    expect(fx.convert(1_000, "JPY", "EUR", "2026-07-29")).toBeUndefined();
    // Every snapshot postdates this, so nothing is applicable yet.
    expect(fx.convert(1_000, "USD", "EUR", "2026-01-01")).toBeUndefined();
  });

  test("returns undefined with no snapshots at all", () => {
    const fx = createFinanceFxConverter([]);
    expect(fx.convert(1_000, "USD", "EUR")).toBeUndefined();
  });
});
