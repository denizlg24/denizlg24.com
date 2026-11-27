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
    expect(result.positions.map((p) => [p.symbol, p.pnl])).toEqual([
      ["AAA", 88],
      ["BBB", 50],
    ]);
    expect(result.positions.reduce((sum, p) => sum + p.pnl, 0)).toBe(
      result.period.pnl,
    );
  });
});

describe("fxInclusiveCost", () => {
  test("converts each buy at its own trade-date rate", () => {
    const { lots } = fxInclusiveCost(
      [
        trade({}),
        trade({ date: "2026-11-04", price: 99 }),
        trade({ side: "sell", quantity: 10, price: 99, date: "2026-11-05" }),
      ],
      fx,
      "USD",
    );
    const lot = lots.get("AAA:EUR");
    expect(lot?.quantity).toBe(10);
    expect(lot?.costBase).toBeCloseTo((1100 + 1188) / 2, 6);
    expect(lot?.costLocal).toBeCloseTo(995, 6);
  });

  test("averages cost within each book before combining books", () => {
    const { lots } = fxInclusiveCost(
      [
        trade({ bookId: "a", quantity: 1, price: 100, currency: "USD" }),
        trade({ bookId: "b", quantity: 1, price: 300, currency: "USD" }),
        trade({
          bookId: "b",
          side: "sell",
          quantity: 1,
          price: 300,
          currency: "USD",
          date: "2026-11-03",
        }),
      ],
      new Map(),
      "USD",
    );
    expect(lots.get("AAA:USD")?.costBase).toBe(100);
  });

  test("keeps the quantity of a buy with no trade-date FX and flags the cost", () => {
    const { lots, missing } = fxInclusiveCost(
      [
        trade({ date: "2026-10-01" }),
        trade({ date: "2026-11-02" }),
        trade({ side: "sell", date: "2026-11-03" }),
      ],
      fx,
      "USD",
    );
    expect(lots.get("AAA:EUR")?.quantity).toBe(10);
    expect(lots.get("AAA:EUR")?.incomplete).toBe(true);
    expect(missing).toEqual(["EUR"]);
  });
});

test("a window with no earlier close still reports its first valuation", () => {
  const result = buildPortfolioHistory({
    base: "EUR",
    trades: [trade({ date: "2026-11-01" })],
    prices: new Map([["AAA:EUR", [bar("2026-11-02", 100)]]]),
    fx: new Map(),
    from: parseDay("2026-11-01"),
    to: parseDay("2026-11-02"),
    focus: parseDay("2026-11-02"),
  });
  expect(result.days).toEqual([
    {
      date: "2026-11-02",
      value: 1000,
      flows: 1000,
      change: null,
      changePercent: null,
    },
  ]);
  expect(result.focus?.value).toBe(1000);
  expect(result.focus?.change).toBeNull();
});

test("the daily % base leaves out positions left out of the change", () => {
  const result = buildPortfolioHistory({
    base: "USD",
    trades: [
      trade({ currency: "USD", quantity: 1, price: 100, date: "2026-11-02" }),
      trade({
        symbol: "GAP",
        currency: "USD",
        quantity: 9,
        price: 100,
        date: "2026-11-03",
      }),
    ],
    prices: new Map([
      ["AAA:USD", [bar("2026-11-02", 100), bar("2026-11-03", 110)]],
      ["GAP:USD", []],
    ]),
    fx: new Map(),
    from: parseDay("2026-11-03"),
    to: parseDay("2026-11-03"),
  });
  expect(result.days[0].change).toBe(10);
  expect(result.days[0].changePercent).toBe(10);
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
