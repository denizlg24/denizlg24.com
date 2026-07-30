import { describe, expect, test } from "bun:test";
import {
  convertMinorWithRate,
  currencyExponent,
  formatMoney,
  majorToMinor,
  minorToMajor,
} from "./money";

describe("currencyExponent", () => {
  test("two decimals for the usual currencies", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("usd")).toBe(2);
  });

  test("zero decimals for JPY and KRW", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
  });

  test("falls back to two for an unknown code", () => {
    expect(currencyExponent("ZZZ")).toBe(2);
  });
});

describe("minor/major conversion", () => {
  test("EUR minor units are hundredths", () => {
    expect(minorToMajor(1_250, "EUR")).toBe(12.5);
    expect(majorToMinor(12.5, "EUR")).toBe(1_250);
  });

  test("JPY minor units are whole yen", () => {
    expect(minorToMajor(1_250, "JPY")).toBe(1_250);
    expect(majorToMinor(1_250, "JPY")).toBe(1_250);
  });
});

describe("convertMinorWithRate", () => {
  // 1 EUR = 1.08 USD
  const eurUsd = 1_080_000;

  test("converts a quote amount back to base", () => {
    expect(
      convertMinorWithRate({
        amountMinor: 10_800,
        fromCurrency: "USD",
        toCurrency: "EUR",
        rateMicros: eurUsd,
        direction: "toBase",
      }),
    ).toBe(10_000);
  });

  test("converts a base amount out to quote", () => {
    expect(
      convertMinorWithRate({
        amountMinor: 10_000,
        fromCurrency: "EUR",
        toCurrency: "USD",
        rateMicros: eurUsd,
        direction: "toQuote",
      }),
    ).toBe(10_800);
  });

  test("applies the exponent gap when converting JPY into EUR", () => {
    // 1 EUR = 160 JPY, so ¥16,000 (16_000 minor) is €100.00 (10_000 minor).
    expect(
      convertMinorWithRate({
        amountMinor: 16_000,
        fromCurrency: "JPY",
        toCurrency: "EUR",
        rateMicros: 160_000_000,
        direction: "toBase",
      }),
    ).toBe(10_000);
  });

  test("applies the exponent gap converting EUR into JPY", () => {
    expect(
      convertMinorWithRate({
        amountMinor: 10_000,
        fromCurrency: "EUR",
        toCurrency: "JPY",
        rateMicros: 160_000_000,
        direction: "toQuote",
      }),
    ).toBe(16_000);
  });

  test("keeps the sign of a negative amount", () => {
    expect(
      convertMinorWithRate({
        amountMinor: -10_800,
        fromCurrency: "USD",
        toCurrency: "EUR",
        rateMicros: eurUsd,
        direction: "toBase",
      }),
    ).toBe(-10_000);
  });
});

describe("formatMoney", () => {
  test("uses two decimals for EUR", () => {
    expect(formatMoney(1_250, "EUR")).toContain("12.50");
  });

  test("uses none for JPY, and does not divide by 100", () => {
    const formatted = formatMoney(1_250, "JPY");
    expect(formatted).toContain("1,250");
    expect(formatted).not.toContain(".");
  });
});
