import { describe, expect, test } from "bun:test";
import { fundamentalsSlice } from "./cron";

const DAY = 86_400_000;

function tickers(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `T${i}`);
}

describe("fundamentalsSlice", () => {
  test("returns everything when the tracked set fits in one run", () => {
    const tracked = tickers(3);
    expect(fundamentalsSlice(tracked, new Date(0))).toEqual(tracked);
  });

  test("advances the window a day at a time", () => {
    const tracked = tickers(12);
    expect(fundamentalsSlice(tracked, new Date(0))).toEqual([
      "T0",
      "T1",
      "T2",
      "T3",
      "T4",
    ]);
    expect(fundamentalsSlice(tracked, new Date(DAY))).toEqual([
      "T5",
      "T6",
      "T7",
      "T8",
      "T9",
    ]);
  });

  test("wraps past the end rather than returning a short slice", () => {
    const slice = fundamentalsSlice(tickers(12), new Date(2 * DAY));
    expect(slice).toEqual(["T10", "T11", "T0", "T1", "T2"]);
  });

  test("every tracked symbol comes round — none is starved", () => {
    const tracked = tickers(17);
    const seen = new Set<string>();
    for (let day = 0; day < 40; day++) {
      for (const ticker of fundamentalsSlice(tracked, new Date(day * DAY))) {
        seen.add(ticker);
      }
    }
    expect(seen.size).toBe(tracked.length);
  });
});
