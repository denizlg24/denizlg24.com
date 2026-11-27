import type { ChartPoint, Trade } from "./models";
import { closesOn, dayOf, isoDay, parseDay } from "./portfolio-risk";

/**
 * Rebuilds a book day by day from its trades: holdings as of each day,
 * valued at that day's traded close and converted at that day's FX rate. Pure
 * so it can be tested without market data.
 */

export type HistoryInput = {
  base: string;
  trades: Trade[];
  /** Unadjusted daily closes per `symbol:currency`. */
  prices: Map<string, ChartPoint[]>;
  /** Daily base-currency value of one unit of each trade currency. */
  fx: Map<string, ChartPoint[]>;
  from: number;
  to: number;
  /** One day to explain position by position. */
  focus?: number;
};

const key = (trade: Pick<Trade, "symbol" | "currency">) =>
  `${trade.symbol}:${trade.currency}`;

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const pct = (part: number, whole: number) =>
  whole > 0 ? round((part / whole) * 100) : null;

type Holding = { symbol: string; currency: string; quantity: number };

function tradingDays(input: HistoryInput) {
  const days = new Set<number>();
  for (const points of input.prices.values())
    for (const point of points) {
      const day = dayOf(point.time);
      if (day <= input.to) days.add(day);
    }
  const sorted = [...days].sort((a, b) => a - b);
  const firstInWindow = sorted.findIndex((day) => day >= input.from);
  if (firstInWindow < 0) return [];
  return sorted.slice(Math.max(0, firstInWindow - 1));
}

function fxOn(input: HistoryInput, currency: string, days: number[]) {
  if (currency === input.base) return days.map(() => 1);
  const points = input.fx.get(currency);
  return points ? closesOn(points, days) : days.map(() => null);
}

/** Base-currency amount a trade moved into (+) or out of (−) the book. */
const tradeFlow = (trade: Trade) =>
  trade.side === "buy"
    ? trade.quantity * trade.price + trade.fees
    : -(trade.quantity * trade.price - trade.fees);

export function buildPortfolioHistory(input: HistoryInput) {
  const days = tradingDays(input);
  const trades = input.trades.toSorted((a, b) => a.date.localeCompare(b.date));
  const keys = [...new Set(trades.map(key))];
  const holdings = new Map<string, Holding>();
  for (const trade of trades)
    holdings.set(key(trade), {
      symbol: trade.symbol,
      currency: trade.currency,
      quantity: 0,
    });

  const closes = new Map(
    keys.map((k) => [k, closesOn(input.prices.get(k) ?? [], days)]),
  );
  const currencies = [...new Set(trades.map((trade) => trade.currency))];
  const rates = new Map(currencies.map((c) => [c, fxOn(input, c, days)]));
  const missing = new Set<string>();

  type Row = {
    day: number;
    value: number;
    flow: number;
    byKey: Map<string, { value: number; flow: number }>;
    /** Held but without a close or FX rate on this day. */
    unpriced: Set<string>;
  };
  const rows: Row[] = [];
  let pointer = 0;
  days.forEach((day, i) => {
    const byKey = new Map<string, { value: number; flow: number }>();
    let flow = 0;
    while (pointer < trades.length && parseDay(trades[pointer].date) <= day) {
      const trade = trades[pointer++];
      const holding = holdings.get(key(trade));
      if (!holding) continue;
      holding.quantity +=
        trade.side === "buy" ? trade.quantity : -trade.quantity;
      if (Math.abs(holding.quantity) < 1e-8) holding.quantity = 0;
      const rate = rates.get(trade.currency)?.[i] ?? null;
      if (rate == null) continue;
      const amount = tradeFlow(trade) * rate;
      flow += amount;
      const entry = byKey.get(key(trade)) ?? { value: 0, flow: 0 };
      entry.flow += amount;
      byKey.set(key(trade), entry);
    }
    let value = 0;
    const unpriced = new Set<string>();
    for (const [k, holding] of holdings) {
      if (holding.quantity <= 0) continue;
      const close = closes.get(k)?.[i] ?? null;
      const rate = rates.get(holding.currency)?.[i] ?? null;
      if (close == null || rate == null) {
        missing.add(close == null ? holding.symbol : holding.currency);
        unpriced.add(k);
        continue;
      }
      const amount = holding.quantity * close * rate;
      value += amount;
      const entry = byKey.get(k) ?? { value: 0, flow: 0 };
      entry.value = amount;
      byKey.set(k, entry);
    }
    rows.push({ day, value, flow, byKey, unpriced });
  });

  // A position that has no price on either side of a day (not yet listed,
  // a gap in a thin listing) would otherwise enter or leave the total as a
  // fake gain or loss; it is left out of that day's change instead.
  const keyChange = (i: number, k: string): number | null => {
    if (rows[i].unpriced.has(k) || rows[i - 1].unpriced.has(k)) return null;
    const now = rows[i].byKey.get(k);
    const before = rows[i - 1].byKey.get(k);
    if (!now && !before) return null;
    return (now?.value ?? 0) - (before?.value ?? 0) - (now?.flow ?? 0);
  };
  const dayChange = (i: number) =>
    keys.reduce((sum, k) => sum + (keyChange(i, k) ?? 0), 0);

  const daily = rows.slice(1).map((row, i) => {
    const previous = rows[i];
    const change = dayChange(i + 1);
    const capital = previous.value + Math.max(row.flow, 0);
    return {
      date: isoDay(row.day),
      value: round(row.value),
      flows: round(row.flow),
      change: round(change),
      changePercent: pct(change, capital),
    };
  });

  const start = rows[0];
  const end = rows.at(-1);
  const netFlows = rows.slice(1).reduce((sum, row) => sum + row.flow, 0);
  let growth = 1;
  let pnl = 0;
  for (let i = 1; i < rows.length; i++) {
    const change = dayChange(i);
    pnl += change;
    const capital = rows[i - 1].value + Math.max(rows[i].flow, 0);
    if (capital > 0) growth *= 1 + change / capital;
  }
  const ranked = daily.filter((row) => row.changePercent != null);
  const best = ranked.reduce<(typeof ranked)[number] | null>(
    (top, row) => (!top || row.change > top.change ? row : top),
    null,
  );
  const worst = ranked.reduce<(typeof ranked)[number] | null>(
    (low, row) => (!low || row.change < low.change ? row : low),
    null,
  );

  const pnlByKey = new Map<string, number>();
  for (let i = 1; i < rows.length; i++)
    for (const k of keys) {
      const change = keyChange(i, k);
      if (change != null) pnlByKey.set(k, (pnlByKey.get(k) ?? 0) + change);
    }
  const startCapital = (start?.value ?? 0) + Math.max(netFlows, 0);
  const positions = [...pnlByKey]
    .map(([k, pnl]) => {
      const holding = holdings.get(k);
      return {
        symbol: holding?.symbol ?? k,
        currency: holding?.currency ?? "",
        pnl: round(pnl),
        contributionPercent: pct(pnl, startCapital),
      };
    })
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  const focusIndex =
    input.focus == null
      ? -1
      : rows.findIndex((row, i) => i > 0 && row.day === input.focus);
  const focus =
    focusIndex > 0
      ? {
          date: isoDay(rows[focusIndex].day),
          previousDate: isoDay(rows[focusIndex - 1].day),
          change: daily[focusIndex - 1].change,
          changePercent: daily[focusIndex - 1].changePercent,
          positions: keys
            .flatMap((k) => {
              const change = keyChange(focusIndex, k);
              if (change == null) return [];
              const close = closes.get(k);
              const today = close?.[focusIndex] ?? null;
              const prior = close?.[focusIndex - 1] ?? null;
              return [
                {
                  symbol: holdings.get(k)?.symbol ?? k,
                  change: round(change),
                  priceChangePercent:
                    today != null && prior
                      ? round((today / prior - 1) * 100)
                      : null,
                  stale: today != null && prior != null && today === prior,
                },
              ];
            })
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
        }
      : null;

  return {
    base: input.base,
    from: daily[0]?.date ?? null,
    to: end ? isoDay(end.day) : null,
    days: daily,
    period: {
      startValue: round(start?.value ?? 0),
      endValue: round(end?.value ?? 0),
      netFlows: round(netFlows),
      pnl: round(pnl),
      timeWeightedReturnPercent:
        rows.length > 1 ? round((growth - 1) * 100) : null,
      bestDay: best,
      worstDay: worst,
    },
    positions,
    focus,
    missing: [...missing],
  };
}

/**
 * Average-cost basis converted at each trade's own FX rate, against today's
 * value at today's rate: the P&L a holder actually has in the base currency.
 */
export function fxInclusiveCost(
  trades: Trade[],
  fx: Map<string, ChartPoint[]>,
  base: string,
) {
  const lots = new Map<
    string,
    { quantity: number; costLocal: number; costBase: number; currency: string }
  >();
  const missing = new Set<string>();
  for (const trade of trades.toSorted((a, b) => a.date.localeCompare(b.date))) {
    const day = parseDay(trade.date);
    const rate =
      trade.currency === base
        ? 1
        : closesOn(fx.get(trade.currency) ?? [], [day])[0];
    if (rate == null) {
      missing.add(trade.currency);
      continue;
    }
    const lot = lots.get(key(trade)) ?? {
      quantity: 0,
      costLocal: 0,
      costBase: 0,
      currency: trade.currency,
    };
    if (trade.side === "buy") {
      lot.quantity += trade.quantity;
      lot.costLocal += trade.quantity * trade.price + trade.fees;
      lot.costBase += (trade.quantity * trade.price + trade.fees) * rate;
    } else if (lot.quantity > 0) {
      const share = Math.min(1, trade.quantity / lot.quantity);
      lot.costLocal -= lot.costLocal * share;
      lot.costBase -= lot.costBase * share;
      lot.quantity -= trade.quantity;
      if (lot.quantity <= 1e-8) {
        lot.quantity = 0;
        lot.costLocal = 0;
        lot.costBase = 0;
      }
    }
    lots.set(key(trade), lot);
  }
  return { lots, missing: [...missing] };
}
