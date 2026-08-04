import { describe, expect, test } from "bun:test";
import type { DailyBar } from "../schemas";
import { getCandles, planDailyFetches, shiftDate } from "./candles";
import { createMemoryStores, fixedClock, makeDailyBar } from "./memory-stores";
import {
  BudgetExhaustedError,
  type MarketDataProvider,
  type MarketStores,
} from "./ports";

const TODAY = "2026-07-31";
const clock = fixedClock(`${TODAY}T12:00:00.000Z`);

interface Call {
  from?: string;
  to?: string;
}

function recordingProvider(bars: DailyBar[]): {
  provider: MarketDataProvider;
  calls: Call[];
} {
  const calls: Call[] = [];
  const provider: MarketDataProvider = {
    name: "tiingo",
    async getDailyBars(_ticker, from, to) {
      calls.push({ from, to });
      return bars.filter(
        (bar) => (!from || bar.date >= from) && (!to || bar.date <= to),
      );
    },
  };
  return { provider, calls };
}

const history: DailyBar[] = [
  makeDailyBar("2026-07-27", 100),
  makeDailyBar("2026-07-28", 102),
  makeDailyBar("2026-07-29", 104),
  makeDailyBar("2026-07-30", 106),
  makeDailyBar("2026-07-31", 108),
];

function stores(): MarketStores {
  return createMemoryStores({ clock });
}

describe("planDailyFetches", () => {
  test("an uncached symbol asks for the whole window", () => {
    expect(planDailyFetches(null, null, "2026-01-01", TODAY)).toEqual([
      { from: "2026-01-01", to: TODAY },
    ]);
  });

  test("a fully covered window asks for nothing", () => {
    expect(
      planDailyFetches("2026-01-01", TODAY, "2026-02-01", "2026-07-01"),
    ).toEqual([]);
  });

  test("only the new tail is requested", () => {
    expect(
      planDailyFetches("2026-01-01", "2026-07-29", "2026-01-01", TODAY),
    ).toEqual([{ from: "2026-07-30", to: TODAY }]);
  });

  test("only the older head is requested", () => {
    expect(planDailyFetches("2026-06-01", TODAY, "2026-01-01", TODAY)).toEqual([
      { from: "2026-01-01", to: "2026-05-31" },
    ]);
  });

  test("widening both ends splits into two edge requests", () => {
    expect(
      planDailyFetches("2026-06-01", "2026-07-01", "2026-01-01", TODAY),
    ).toEqual([
      { from: "2026-01-01", to: "2026-05-31" },
      { from: "2026-07-02", to: TODAY },
    ]);
  });

  test("an open-ended request backfills past what the cache already holds", () => {
    // The chart opens on its one-year range; switching to MAX must not be
    // answered out of that year.
    expect(planDailyFetches("2025-08-01", TODAY, undefined, TODAY)).toEqual([
      { from: undefined, to: "2025-07-31" },
    ]);
  });

  test("an already backfilled symbol asks for nothing older", () => {
    expect(
      planDailyFetches("1980-12-12", TODAY, undefined, TODAY, true),
    ).toEqual([]);
  });

  test("shiftDate crosses month boundaries", () => {
    expect(shiftDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftDate("2026-07-31", 1)).toBe("2026-08-01");
  });
});

describe("getCandles daily", () => {
  test("a cold symbol fetches once and caches", async () => {
    const store = stores();
    const { provider, calls } = recordingProvider(history);
    const series = await getCandles(store, provider, {
      ticker: "AAPL",
      resolution: "1day",
      from: "2026-07-27",
      adjusted: false,
    });
    expect(calls).toHaveLength(1);
    expect(series.bars).toHaveLength(5);
    expect(series.freshness.stale).toBe(false);
    expect(series.bars.at(-1)?.close).toBe(108);
  });

  test("an identical repeat request spends no budget", async () => {
    const store = stores();
    const { provider, calls } = recordingProvider(history);
    const request = {
      ticker: "AAPL",
      resolution: "1day" as const,
      from: "2026-07-27",
      adjusted: false,
    };
    await getCandles(store, provider, request);
    const second = await getCandles(store, provider, request);
    expect(calls).toHaveLength(1);
    expect(second.bars).toHaveLength(5);
    expect(second.freshness.source).toBe("cache");
  });

  test("adjusted and raw pull different columns from the same rows", async () => {
    const store = stores();
    const { provider } = recordingProvider(history);
    const raw = await getCandles(store, provider, {
      ticker: "AAPL",
      resolution: "1day",
      from: "2026-07-27",
      adjusted: false,
    });
    const adjusted = await getCandles(store, provider, {
      ticker: "AAPL",
      resolution: "1day",
      from: "2026-07-27",
      adjusted: true,
    });
    expect(raw.bars.at(-1)?.close).toBe(108);
    expect(adjusted.bars.at(-1)?.close).toBe(54);
  });

  test("dividends and splits are harvested from the same rows", async () => {
    const store = stores();
    const withAction = makeDailyBar("2026-07-29", 104);
    withAction.divCash = 0.24;
    const { provider } = recordingProvider([
      makeDailyBar("2026-07-27", 100),
      withAction,
    ]);
    await getCandles(store, provider, {
      ticker: "KO",
      resolution: "1day",
      from: "2026-07-27",
      adjusted: false,
    });
    const actions = await store.bars.getActions("KO");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.divCash).toBeCloseTo(0.24, 10);
  });

  test("an open-ended repeat request does not re-backfill", async () => {
    const store = stores();
    const { provider, calls } = recordingProvider(history);
    const request = {
      ticker: "AAPL",
      resolution: "1day" as const,
      to: TODAY,
      adjusted: false,
    };
    await getCandles(store, provider, request);
    await getCandles(store, provider, request);
    expect(calls).toHaveLength(1);
  });

  test("an exhausted budget serves cache marked stale instead of throwing", async () => {
    const store = createMemoryStores({ clock, hourLimit: 0 });
    const provider: MarketDataProvider = {
      name: "tiingo",
      async getDailyBars() {
        throw new BudgetExhaustedError("tiingo");
      },
    };
    await store.bars.upsertDailyBars("AAPL", history);

    const series = await getCandles(store, provider, {
      ticker: "AAPL",
      resolution: "1day",
      from: "2026-07-27",
      adjusted: false,
    });
    expect(series.freshness.stale).toBe(true);
    expect(series.bars).toHaveLength(5);
  });

  test("a provider failure that is not a budget stop still surfaces", async () => {
    const store = stores();
    const provider: MarketDataProvider = {
      name: "tiingo",
      async getDailyBars() {
        throw new Error("upstream exploded");
      },
    };
    await expect(
      getCandles(store, provider, {
        ticker: "AAPL",
        resolution: "1day",
        adjusted: false,
      }),
    ).rejects.toThrow("upstream exploded");
  });
});
