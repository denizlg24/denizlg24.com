import { describe, expect, test } from "bun:test";
import type { ChartPoint, Trade } from "./models";
import { buildPortfolioHistory, fxInclusiveCost } from "./portfolio-history";
import { parseDay } from "./portfolio-risk";

const bar = (date: string, close: number): ChartPoint => ({
  time: parseDay(date) * 86_400 + 9 * 3600,
  open: close,
  high: close,
  low: close,
  close,
  volume: null,
});

const trade = (overrides: Partial<Trade>): Trade => ({
  id: crypto.randomUUID(),
  bookId: "book",
  symbol: "AAA",
  side: "buy",
  quantity: 10,
  price: 100,
  fees: 0,
  currency: "EUR",
  date: "2026-11-02",
  ...overrides,
});

const prices = new Map([
  [
    "AAA:EUR",
    [
      bar("2026-11-02", 100),
      bar("2026-11-03", 110),
      bar("2026-11-04", 99),
      bar("2026-11-05", 99),
    ],
  ],
  [
    "BBB:USD",
    [bar("2026-11-03", 50), bar("2026-11-04", 55), bar("2026-11-05", 55)],
  ],
]);
const fx = new Map([
  [
    "EUR",
    [
      bar("2026-11-02", 1.1),
      bar("2026-11-03", 1.1),
      bar("2026-11-04", 1.2),
      bar("2026-11-05", 1.2),
    ],
  ],
]);

describe("buildPortfolioHistory", () => {
  const trades = [
    trade({}),
    trade({ symbol: "BBB", currency: "USD", price: 50, date: "2026-11-04" }),
  ];
  const result = buildPortfolioHistory({
    base: "USD",
    trades,
    prices,
    fx,
    from: parseDay("2026-11-03"),
    to: parseDay("2026-11-05"),
    focus: parseDay("2026-11-04"),
  });

  test("day changes exclude the money a trade brought in", () => {
    expect(result.days.map((day) => day.date)).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    // 10 × 110 × 1.1 − 10 × 100 × 1.1
    expect(result.days[0].change).toBe(110);
    // AAA 10 × 99 × 1.2 − 1210 = −22; BBB bought at 50, closed 55 → +50
    expect(result.days[1].flows).toBe(500);
    expect(result.days[1].change).toBe(28);
    expect(result.days[2].change).toBe(0);
  });

  test("the focus day is explained position by position", () => {
    expect(result.focus?.date).toBe("2026-11-04");
    expect(result.focus?.positions).toEqual([
      { symbol: "BBB", change: 50, priceChangePercent: 10, stale: false },
      { symbol: "AAA", change: -22, priceChangePercent: -10, stale: false },
    ]);
    expect(result.days[2].date).toBe("2026-11-05");
  });

  test("period P&L adds up across days and positions", () => {
    expect(result.period.pnl).toBe(138);
    expect(result.period.netFlows).toBe(500);
    expect(result.period.bestDay?.date).toBe("2026-11-03");
    expect(result.positions.map((p) => p.symbol)).toEqual(["AAA", "BBB"]);
  });
});

test("fxInclusiveCost converts each buy at its own trade-date rate", () => {
  const { lots } = fxInclusiveCost(
    [
      trade({}),
      trade({ side: "sell", quantity: 5, price: 99, date: "2026-11-04" }),
    ],
    fx,
    "USD",
  );
  const lot = lots.get("AAA:EUR");
  expect(lot?.quantity).toBe(5);
  expect(lot?.costLocal).toBe(500);
  expect(lot?.costBase).toBeCloseTo(550, 6);
});

test("a position without a price on either side of a day is not a gain", () => {
  const sparse = new Map([...prices, ["NEW:EUR", [bar("2026-11-05", 40)]]]);
  const result = buildPortfolioHistory({
    base: "EUR",
    trades: [
      trade({}),
      trade({ symbol: "NEW", price: 40, date: "2026-11-01" }),
    ],
    prices: sparse,
    fx: new Map(),
    from: parseDay("2026-11-03"),
    to: parseDay("2026-11-05"),
  });
  expect(result.days.at(-1)?.date).toBe("2026-11-05");
  expect(result.days.at(-1)?.value).toBe(1390);
  expect(result.days.at(-1)?.change).toBe(0);
  expect(result.missing).toContain("NEW");
});
