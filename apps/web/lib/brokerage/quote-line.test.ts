import { describe, expect, test } from "bun:test";
import {
  alternativeFor,
  chooseLine,
  currencyLine,
  probeQuote,
  yahooLine,
} from "./quote-line";

const now = Date.parse("2026-11-26T12:00:00Z");
const quote = (_ticker: string, currency: string | null, ts: string) => ({
  currency,
  ts,
});

describe("yahooLine", () => {
  test("maps the listing exchange to the Yahoo suffix", () => {
    expect(yahooLine("AAPL", "NASDAQ", "USD")).toEqual({
      ticker: "AAPL",
      currency: "USD",
      scale: 1,
    });
    expect(yahooLine("SAP", "IBIS2", "EUR")?.ticker).toBe("SAP.DE");
    expect(yahooLine("BRK B", "NYSE", "USD")?.ticker).toBe("BRK-B");
  });

  test("zero-pads Hong Kong codes", () => {
    expect(yahooLine("5", "SEHK", "HKD")?.ticker).toBe("0005.HK");
  });

  test("quotes London lines in pence", () => {
    expect(yahooLine("VOD", "LSE", "GBP")).toEqual({
      ticker: "VOD.L",
      currency: "GBp",
      scale: 100,
    });
    expect(yahooLine("VUSA", "LSEETF", "USD")?.currency).toBe("USD");
  });

  test("returns null for an unmapped venue", () => {
    expect(yahooLine("X", "NOWHERE", "USD")).toBeNull();
  });
});

describe("currency line", () => {
  const gold = yahooLine("GOLD", "SBF", "EUR");

  test("builds BASE-CCY.SUFFIX", () => {
    expect(gold && currencyLine(gold)?.ticker).toBe("GOLD-EUR.PA");
  });

  test("never applies to minor units or suffix-less tickers", () => {
    const pence = yahooLine("VOD", "LSE", "GBP");
    const us = yahooLine("AAPL", "NASDAQ", "USD");
    expect(pence && currencyLine(pence)).toBeNull();
    expect(us && currencyLine(us)).toBeNull();
  });

  test("GOLD resolves to the live EUR line when GOLD.PA is a dead USD line", () => {
    if (!gold) throw new Error("GOLD should map");
    const dead = probeQuote(
      quote("GOLD.PA", "USD", "2023-10-12T15:00:00Z"),
      gold,
      now,
      true,
    );
    expect(dead).toBe("wrong");
    const alternative = alternativeFor(gold, dead);
    if (!alternative) throw new Error("expected an alternative");
    const live = probeQuote(
      quote("GOLD-EUR.PA", "EUR", "2026-11-26T11:00:00Z"),
      alternative,
      now,
      true,
    );
    expect(chooseLine(gold, alternative, live).ticker).toBe("GOLD-EUR.PA");
  });

  test("a wrong-currency quote on a fresh line is still wrong", () => {
    if (!gold) throw new Error("GOLD should map");
    expect(
      probeQuote(
        quote("GOLD.PA", "USD", "2026-11-26T11:00:00Z"),
        gold,
        now,
        true,
      ),
    ).toBe("wrong");
  });

  test("an inconclusive probe keeps the default mapping", () => {
    if (!gold) throw new Error("GOLD should map");
    const unknown = probeQuote(undefined, gold, now, false);
    expect(unknown).toBe("unknown");
    expect(alternativeFor(gold, unknown)).toBeNull();
    expect(chooseLine(gold, null, undefined)).toBe(gold);
  });

  test("keeps the default when the alternative is not live either", () => {
    if (!gold) throw new Error("GOLD should map");
    const alternative = currencyLine(gold);
    expect(chooseLine(gold, alternative, "wrong")).toBe(gold);
    expect(chooseLine(gold, alternative, "unknown")).toBe(gold);
  });

  test("a recent quote without a currency proves nothing", () => {
    const gold = yahooLine("GOLD", "SBF", "EUR");
    if (!gold) throw new Error("GOLD should map");
    const probe = probeQuote(
      quote("GOLD.PA", null, "2026-11-26T11:00:00Z"),
      gold,
      now,
      true,
    );
    expect(probe).toBe("unknown");
    expect(alternativeFor(gold, probe)).toBeNull();
  });

  test("a healthy default line is left alone", () => {
    const sap = yahooLine("SAP", "IBIS2", "EUR");
    if (!sap) throw new Error("SAP should map");
    const probe = probeQuote(
      quote("SAP.DE", "EUR", "2026-11-26T11:00:00Z"),
      sap,
      now,
      true,
    );
    expect(probe).toBe("live");
    expect(alternativeFor(sap, probe)).toBeNull();
  });
});
