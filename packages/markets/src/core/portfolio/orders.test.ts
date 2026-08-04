import { describe, expect, test } from "bun:test";
import type { MarginConfig, Order, Position } from "../../schemas";
import { computeMargin } from "./margin";
import {
  checkAdmissible,
  evaluateOrder,
  executableQuantity,
  type OrderMarketContext,
  trailingStopPrice,
} from "./orders";

function order(overrides: Partial<Order> & Pick<Order, "type">): Order {
  return {
    id: "o1",
    portfolioId: "p1",
    ticker: "AAPL",
    side: "sell",
    quantity: 10,
    limitPrice: null,
    stopPrice: null,
    trailBasis: null,
    trailValue: null,
    trailAnchor: null,
    stopTriggeredAt: null,
    timeInForce: "gtc",
    expiresAt: null,
    reduceOnly: false,
    status: "working",
    parentOrderId: null,
    ocoGroupId: null,
    filledQuantity: 0,
    filledPrice: null,
    filledAt: null,
    tradeId: null,
    statusReason: null,
    fees: 0,
    createdAt: "2026-03-01T14:00:00.000Z",
    updatedAt: "2026-03-01T14:00:00.000Z",
    ...overrides,
  };
}

function context(
  overrides: Partial<OrderMarketContext> = {},
): OrderMarketContext {
  return {
    last: null,
    bar: null,
    now: "2026-03-02T14:00:00.000Z",
    ...overrides,
  };
}

const bar = (open: number, high: number, low: number, close: number) => ({
  open,
  high,
  low,
  close,
});

describe("market orders", () => {
  test("fill at the open of the interval they were sent into", () => {
    const decision = evaluateOrder(
      order({ type: "market" }),
      context({ bar: bar(101, 105, 99, 104), last: 104 }),
    );
    expect(decision).toEqual({ kind: "fill", price: 101 });
  });

  test("fall back to the last print when no bar covers the interval", () => {
    expect(
      evaluateOrder(order({ type: "market" }), context({ last: 104 })),
    ).toEqual({ kind: "fill", price: 104 });
  });

  test("hold rather than guess when there is no price at all", () => {
    expect(evaluateOrder(order({ type: "market" }), context())).toEqual({
      kind: "hold",
    });
  });
});

describe("limit orders", () => {
  test("a sell limit fills once the bar trades up to it", () => {
    expect(
      evaluateOrder(
        order({ type: "limit", side: "sell", limitPrice: 110 }),
        context({ bar: bar(100, 112, 99, 108) }),
      ),
    ).toEqual({ kind: "fill", price: 110 });
  });

  test("a sell limit gapped through fills at the better open", () => {
    expect(
      evaluateOrder(
        order({ type: "limit", side: "sell", limitPrice: 110 }),
        context({ bar: bar(115, 118, 114, 116) }),
      ),
    ).toEqual({ kind: "fill", price: 115 });
  });

  test("a buy limit the bar never reached stays working", () => {
    expect(
      evaluateOrder(
        order({ type: "limit", side: "buy", limitPrice: 90 }),
        context({ bar: bar(100, 105, 95, 102) }),
      ),
    ).toEqual({ kind: "hold" });
  });

  test("a buy limit gapped through fills at the better open", () => {
    expect(
      evaluateOrder(
        order({ type: "limit", side: "buy", limitPrice: 90 }),
        context({ bar: bar(85, 88, 80, 87) }),
      ),
    ).toEqual({ kind: "fill", price: 85 });
  });
});

describe("stop orders", () => {
  test("a stop loss fills at the stop when the bar dips through it", () => {
    expect(
      evaluateOrder(
        order({ type: "stop", side: "sell", stopPrice: 95 }),
        context({ bar: bar(100, 102, 93, 101) }),
      ),
    ).toEqual({ kind: "fill", price: 95 });
  });

  test("a stop loss the price dived through and recovered still fills", () => {
    // The whole reason the bar range is consulted: the closing quote is back
    // above the stop, and a quote-only engine would leave it working.
    const decision = evaluateOrder(
      order({ type: "stop", side: "sell", stopPrice: 95 }),
      context({ bar: bar(100, 104, 90, 103), last: 103 }),
    );
    expect(decision).toEqual({ kind: "fill", price: 95 });
  });

  test("a stop gapped through fills at the gap, not at the stop", () => {
    expect(
      evaluateOrder(
        order({ type: "stop", side: "sell", stopPrice: 95 }),
        context({ bar: bar(88, 92, 85, 90) }),
      ),
    ).toEqual({ kind: "fill", price: 88 });
  });

  test("a buy stop triggers on the way up", () => {
    expect(
      evaluateOrder(
        order({ type: "stop", side: "buy", stopPrice: 110 }),
        context({ bar: bar(100, 115, 99, 112) }),
      ),
    ).toEqual({ kind: "fill", price: 110 });
  });
});

describe("stop-limit orders", () => {
  test("a limit that is marketable on arming fills at the arm price", () => {
    // Selling with a 94 limit while the stop trips at 95 is immediately
    // marketable, so it fills at 95 — better than the limit, as it would at a
    // broker. The limit is a floor, not the price.
    expect(
      evaluateOrder(
        order({
          type: "stop_limit",
          side: "sell",
          stopPrice: 95,
          limitPrice: 94,
        }),
        context({ bar: bar(100, 101, 93, 96) }),
      ),
    ).toEqual({ kind: "fill", price: 95 });
  });

  test("an untouched stop keeps the order dormant", () => {
    const decision = evaluateOrder(
      order({
        type: "stop_limit",
        side: "sell",
        stopPrice: 95,
        limitPrice: 94,
      }),
      context({ bar: bar(100, 101, 96, 97), last: 97 }),
    );
    expect(decision).toEqual({ kind: "hold" });
  });

  test("a gap straight past the limit latches the stop without filling", () => {
    // The classic stop-limit failure: the price jumped from above the stop to
    // below the limit, so there was never a moment the order could work.
    const decision = evaluateOrder(
      order({
        type: "stop_limit",
        side: "sell",
        stopPrice: 95,
        limitPrice: 94,
      }),
      context({ bar: bar(90, 92, 85, 91) }),
    );
    expect(decision).toEqual({
      kind: "hold",
      stopTriggeredAt: "2026-03-02T14:00:00.000Z",
    });
  });

  test("a latched stop works the whole interval and does not disarm", () => {
    const decision = evaluateOrder(
      order({
        type: "stop_limit",
        side: "sell",
        stopPrice: 95,
        limitPrice: 94,
        stopTriggeredAt: "2026-03-01T20:00:00.000Z",
      }),
      // Nowhere near the stop this bar, but it opens above the resting limit.
      context({ bar: bar(96, 99, 93, 98) }),
    );
    expect(decision).toEqual({ kind: "fill", price: 96 });
  });
});

describe("trailing stops", () => {
  test("the anchor ratchets up with the high and never back down", () => {
    const first = evaluateOrder(
      order({
        type: "trailing_stop",
        side: "sell",
        trailBasis: "amount",
        trailValue: 5,
        trailAnchor: 100,
      }),
      context({ bar: bar(100, 120, 99, 118) }),
    );
    expect(first).toEqual({ kind: "hold", trailAnchor: 120 });

    const second = evaluateOrder(
      order({
        type: "trailing_stop",
        side: "sell",
        trailBasis: "amount",
        trailValue: 5,
        trailAnchor: 120,
      }),
      context({ bar: bar(118, 119, 117, 118) }),
    );
    expect(second).toEqual({ kind: "hold" });
  });

  test("fills against the anchor as it stood coming into the bar", () => {
    // A bar that made a new high and then collapsed must still fill at the old
    // stop: ratcheting first would widen it retroactively and let the loss run.
    const decision = evaluateOrder(
      order({
        type: "trailing_stop",
        side: "sell",
        trailBasis: "amount",
        trailValue: 5,
        trailAnchor: 100,
      }),
      context({ bar: bar(100, 130, 90, 92) }),
    );
    expect(decision).toEqual({ kind: "fill", price: 95 });
  });

  test("a percent trail measures from the anchor", () => {
    const decision = evaluateOrder(
      order({
        type: "trailing_stop",
        side: "sell",
        trailBasis: "percent",
        trailValue: 0.1,
        trailAnchor: 200,
      }),
      context({ bar: bar(190, 195, 179, 181) }),
    );
    expect(decision).toEqual({ kind: "fill", price: 180 });
  });

  test("a buy trail on a short ratchets down with the low", () => {
    const decision = evaluateOrder(
      order({
        type: "trailing_stop",
        side: "buy",
        trailBasis: "amount",
        trailValue: 4,
        trailAnchor: 100,
      }),
      context({ bar: bar(99, 101, 80, 82) }),
    );
    expect(decision).toEqual({ kind: "hold", trailAnchor: 80 });
  });

  test("seeds its anchor from the first bar it sees", () => {
    const decision = evaluateOrder(
      order({
        type: "trailing_stop",
        side: "sell",
        trailBasis: "amount",
        trailValue: 5,
      }),
      context({ bar: bar(100, 110, 108, 109) }),
    );
    expect(decision).toEqual({ kind: "hold", trailAnchor: 110 });
  });

  test("reports the level it is currently resting at", () => {
    expect(
      trailingStopPrice(
        order({
          type: "trailing_stop",
          side: "sell",
          trailBasis: "percent",
          trailValue: 0.08,
          trailAnchor: 250,
        }),
      ),
    ).toBeCloseTo(230, 10);
  });
});

describe("time in force", () => {
  test("a day order that did not fill expires on the next session", () => {
    expect(
      evaluateOrder(
        order({
          type: "limit",
          side: "sell",
          limitPrice: 500,
          timeInForce: "day",
        }),
        context({ bar: bar(100, 105, 99, 102) }),
      ),
    ).toEqual({ kind: "expire" });
  });

  test("a day order still fills on the bar it was placed for", () => {
    expect(
      evaluateOrder(
        order({
          type: "limit",
          side: "sell",
          limitPrice: 104,
          timeInForce: "day",
        }),
        context({ bar: bar(100, 105, 99, 102) }),
      ),
    ).toEqual({ kind: "fill", price: 104 });
  });

  test("a good-till-date order lives until its date passes", () => {
    const gtd = order({
      type: "limit",
      side: "sell",
      limitPrice: 500,
      timeInForce: "gtd",
      expiresAt: "2026-03-10T00:00:00.000Z",
    });
    expect(
      evaluateOrder(gtd, context({ bar: bar(100, 105, 99, 102) })),
    ).toEqual({ kind: "hold" });
    expect(
      evaluateOrder(
        gtd,
        context({
          bar: bar(100, 105, 99, 102),
          now: "2026-03-11T14:00:00.000Z",
        }),
      ),
    ).toEqual({ kind: "expire" });
  });

  test("a good-till-cancelled order never expires on its own", () => {
    expect(
      evaluateOrder(
        order({ type: "limit", side: "sell", limitPrice: 500 }),
        context({
          bar: bar(100, 105, 99, 102),
          now: "2030-01-01T00:00:00.000Z",
        }),
      ),
    ).toEqual({ kind: "hold" });
  });
});

describe("reduce-only sizing", () => {
  const position = (quantity: number): Position => ({
    ticker: "AAPL",
    quantity,
    side: quantity < 0 ? "short" : "long",
    avgCost: 100,
    costBasis: 100 * quantity,
    lastPrice: 100,
    marketValue: 100 * quantity,
    exposure: Math.abs(100 * quantity),
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    realizedPnl: 0,
    dayChange: 0,
    dayChangePercent: 0,
    weight: 1,
    maintenanceMargin: 0,
    breakEven: 100,
  });

  test("clamps to the shares actually held", () => {
    expect(
      executableQuantity(
        order({ type: "stop", side: "sell", quantity: 50, reduceOnly: true }),
        [position(20)],
      ),
    ).toEqual({ quantity: 20, cancelReason: null });
  });

  test("cancels once the position it protected is gone", () => {
    const result = executableQuantity(
      order({ type: "stop", side: "sell", quantity: 50, reduceOnly: true }),
      [],
    );
    expect(result.quantity).toBe(0);
    expect(result.cancelReason).toContain("No long position left");
  });

  test("a cover stop reduces a short rather than opening a long", () => {
    expect(
      executableQuantity(
        order({ type: "stop", side: "buy", quantity: 50, reduceOnly: true }),
        [position(-30)],
      ),
    ).toEqual({ quantity: 30, cancelReason: null });
  });

  test("an unrestricted order is never clamped", () => {
    expect(
      executableQuantity(
        order({ type: "market", side: "buy", quantity: 5 }),
        [],
      ),
    ).toEqual({ quantity: 5, cancelReason: null });
  });
});

describe("admission", () => {
  const config: MarginConfig = {
    enabled: true,
    initialLong: 0.5,
    initialShort: 1.5,
    maintenanceLong: 0.25,
    maintenanceShort: 0.3,
    borrowRate: 0.03,
  };
  const flat = computeMargin({ cash: 10_000, positions: [], config });

  test("accepts an order the buying power covers", () => {
    expect(
      checkAdmissible({
        order: {
          ticker: "AAPL",
          side: "buy",
          quantity: 100,
          reduceOnly: false,
        },
        positions: [],
        margin: flat,
        config,
        allowShorts: true,
        referencePrice: 150,
      }),
    ).toBeNull();
  });

  test("rejects an order past buying power with both figures", () => {
    const reason = checkAdmissible({
      order: { ticker: "AAPL", side: "buy", quantity: 1000, reduceOnly: false },
      positions: [],
      margin: flat,
      config,
      allowShorts: true,
      referencePrice: 150,
    });
    expect(reason).toContain("75000.00");
    expect(reason).toContain("10000.00");
  });

  test("rejects a short when the portfolio does not allow one", () => {
    expect(
      checkAdmissible({
        order: {
          ticker: "AAPL",
          side: "sell",
          quantity: 10,
          reduceOnly: false,
        },
        positions: [],
        margin: flat,
        config,
        allowShorts: false,
        referencePrice: 150,
      }),
    ).toContain("Shorting is off");
  });

  test("a closing order needs no buying power at all", () => {
    const long: Position = {
      ticker: "AAPL",
      quantity: 1000,
      side: "long",
      avgCost: 150,
      costBasis: 150_000,
      lastPrice: 150,
      marketValue: 150_000,
      exposure: 150_000,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      realizedPnl: 0,
      dayChange: 0,
      dayChangePercent: 0,
      weight: 1,
      maintenanceMargin: 37_500,
      breakEven: 150,
    };
    expect(
      checkAdmissible({
        order: {
          ticker: "AAPL",
          side: "sell",
          quantity: 1000,
          reduceOnly: true,
        },
        positions: [long],
        margin: computeMargin({ cash: 0, positions: [long], config }),
        config,
        allowShorts: false,
        referencePrice: 150,
      }),
    ).toBeNull();
  });
});
