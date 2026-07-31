import { describe, expect, test } from "bun:test";
import { macd, rsi, stochastic } from "./momentum";
import { ema, sma, wilderSmooth, wma } from "./moving-averages";
import { atr, bollinger, trueRange } from "./volatility";
import { obv, vwap } from "./volume";

describe("moving averages", () => {
  test("sma pads the warm-up window and keeps input length", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  test("sma of a shorter series is all null", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });

  test("ema seeds from the simple average of the first window", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  test("wma weights the most recent value hardest", () => {
    const result = wma([1, 2, 3], 3);
    expect(result[2]).toBeCloseTo(14 / 6, 10);
  });

  test("wilder smoothing decays by 1/period, not 2/(period+1)", () => {
    const result = wilderSmooth([1, 2, 3, 4], 2);
    expect(result[1]).toBeCloseTo(1.5, 10);
    expect(result[2]).toBeCloseTo(2.25, 10);
    expect(result[3]).toBeCloseTo(3.125, 10);
  });

  test("period must be a positive integer", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(RangeError);
    expect(() => sma([1, 2, 3], 1.5)).toThrow(RangeError);
  });
});

describe("rsi", () => {
  const rising = Array.from({ length: 20 }, (_, i) => i + 1);

  test("an unbroken advance pins at 100", () => {
    const result = rsi(rising, 14);
    expect(result[13]).toBeNull();
    expect(result[14]).toBe(100);
    expect(result[19]).toBe(100);
  });

  test("an unbroken decline pins at 0", () => {
    const result = rsi([...rising].reverse(), 14);
    expect(result[14]).toBe(0);
  });

  test("a flat series has no momentum in either direction", () => {
    const result = rsi(new Array(20).fill(50), 14);
    expect(result[14]).toBe(50);
  });

  test("known Wilder-style sequence", () => {
    const closes = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08,
      45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    const result = rsi(closes, 14);
    expect(result[14] as number).toBeCloseTo(70.46, 1);
  });
});

describe("macd", () => {
  test("a constant series has no divergence", () => {
    const flat = new Array(40).fill(100);
    const { macd: line, signal, histogram } = macd(flat);
    expect(line[24]).toBeNull();
    expect(line[25]).toBeCloseTo(0, 10);
    expect(signal[33] as number).toBeCloseTo(0, 10);
    expect(histogram[33] as number).toBeCloseTo(0, 10);
  });

  test("signal warm-up is measured from where the macd line starts", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    const { signal } = macd(values);
    expect(signal[32]).toBeNull();
    expect(signal[33]).not.toBeNull();
  });

  test("a rising series drives macd positive", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i * 2);
    const { macd: line } = macd(values);
    expect(line[59] as number).toBeGreaterThan(0);
  });
});

describe("stochastic", () => {
  test("closing at the top of the range reads 100", () => {
    const highs = new Array(20).fill(10);
    const lows = new Array(20).fill(5);
    const closes = new Array(20).fill(10);
    const { k, d } = stochastic(highs, lows, closes, 14, 3);
    expect(k[13]).toBe(100);
    expect(d[15]).toBe(100);
    expect(d[14]).toBeNull();
  });

  test("a zero-width range is neutral rather than NaN", () => {
    const flat = new Array(20).fill(7);
    const { k } = stochastic(flat, flat, flat, 14, 3);
    expect(k[13]).toBe(50);
  });
});

describe("volatility", () => {
  test("bollinger uses population deviation over the window", () => {
    const { middle, upper, lower } = bollinger([1, 2, 3, 4, 5], 5, 2);
    expect(middle[4]).toBe(3);
    expect(upper[4] as number).toBeCloseTo(3 + 2 * Math.SQRT2, 10);
    expect(lower[4] as number).toBeCloseTo(3 - 2 * Math.SQRT2, 10);
  });

  test("true range spans the previous close", () => {
    const tr = trueRange([10, 12], [8, 11], [9, 11]);
    expect(tr[0]).toBe(2);
    expect(tr[1]).toBe(3);
  });

  test("atr smooths true range with Wilder's average", () => {
    const highs = [10, 12, 13, 14];
    const lows = [8, 11, 11, 12];
    const closes = [9, 11, 12, 13];
    const result = atr(highs, lows, closes, 2);
    expect(result[0]).toBeNull();
    expect(result[1] as number).toBeCloseTo(2.5, 10);
  });
});

describe("volume", () => {
  test("obv accumulates volume in the direction of the close", () => {
    expect(obv([10, 11, 10, 12], [100, 200, 300, 400])).toEqual([
      0, 200, -100, 300,
    ]);
  });

  test("vwap resets on each session key", () => {
    const highs = [10, 20, 30];
    const lows = [10, 20, 30];
    const closes = [10, 20, 30];
    const volumes = [100, 100, 100];
    const withReset = vwap(highs, lows, closes, volumes, [
      "2026-01-01",
      "2026-01-01",
      "2026-01-02",
    ]);
    expect(withReset[1] as number).toBeCloseTo(15, 10);
    expect(withReset[2] as number).toBeCloseTo(30, 10);
  });

  test("vwap without session keys runs from the first bar", () => {
    const result = vwap([10, 20], [10, 20], [10, 20], [100, 100]);
    expect(result[1] as number).toBeCloseTo(15, 10);
  });
});
