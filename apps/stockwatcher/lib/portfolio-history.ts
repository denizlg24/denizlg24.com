import type { ChartPoint, Trade } from "./models";
import { closesOn, dayOf, isoDay, parseDay } from "./portfolio-risk";

/**
 * Rebuilds a book day by day from its trades: holdings as of each day,
 * valued at that day's traded close and converted at that day's FX rate. Pure
 * so it can be tested without market data.
 *
 * Flow timing: the ledger has trade dates, not times, so a buy is treated as
 * money that arrived at the start of its day (it is part of the day's capital)
 * and a sale as money that left at the end of it (it is not).
 */

export type HistoryInput = {
  base: string;
  trades: Trade[];
  /**
   * Daily closes per `symbol:currency` in the trade's price unit, adjusted
   * for splits but not dividends; trades must be in the same share units.
   */
  prices: Map<string, ChartPoint[]>;
  /** Daily base-currency value of one unit of each trade currency. */
  fx: Map<string, ChartPoint[]>;
  from: number;
  to: number;
  /** One day to explain position by position. */
  focus?: number;
};

export const positionKey = (trade: Pick<Trade, "symbol" | "currency">) =>
  `${trade.symbol}:${trade.currency}`;

const round = (value: number, places = 2) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
const pct = (part: number, whole: number) =>
  whole > 0 ? round((part / whole) * 100) : null;

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

/** Amount a trade moved into (+) or out of (−) the book, in its currency. */
const tradeFlow = (trade: Trade) =>
  trade.side === "buy"
    ? trade.quantity * trade.price + trade.fees
    : -(trade.quantity * trade.price - trade.fees);

const events = (trades: Trade[]) =>
  trades
    .map((trade) => ({
      day: parseDay(trade.date),
      key: positionKey(trade),
      trade,
    }))
    .sort((a, b) => a.day - b.day);

type KeyDay = { value: number; flow: number; inflow: number };

export function buildPortfolioHistory(input: HistoryInput) {
  const days = tradingDays(input);
  const keys = [...new Set(input.trades.map(positionKey))];
  const symbolOf = new Map(
    input.trades.map((trade) => [positionKey(trade), trade]),
  );
  const quantities = new Map(keys.map((k) => [k, 0]));
  const closes = new Map(
    keys.map((k) => [k, closesOn(input.prices.get(k) ?? [], days)]),
  );
  const currencies = [...new Set(input.trades.map((t) => t.currency))];
  const rates = new Map(currencies.map((c) => [c, fxOn(input, c, days)]));
  const queue = events(input.trades);
  const missing = new Set<string>();

  type Row = {
    day: number;
    value: number;
    byKey: Map<string, KeyDay>;
    /** Held but without a close or FX rate on this day. */
    unpriced: Set<string>;
  };
  const rows: Row[] = [];
  let pointer = 0;
  days.forEach((day, i) => {
    const byKey = new Map<string, KeyDay>();
    const entry = (k: string) => {
      const found = byKey.get(k) ?? { value: 0, flow: 0, inflow: 0 };
      byKey.set(k, found);
      return found;
    };
    while (pointer < queue.length && queue[pointer].day <= day) {
      const event = queue[pointer++];
      const held = quantities.get(event.key) ?? 0;
      const { trade } = event;
      const next = held + (trade.side === "buy" ? 1 : -1) * trade.quantity;
      quantities.set(event.key, Math.abs(next) < 1e-8 ? 0 : next);
      const rate = rates.get(trade.currency)?.[i] ?? null;
      if (rate == null) continue;
      const amount = tradeFlow(trade) * rate;
      const target = entry(event.key);
      target.flow += amount;
      if (amount > 0) target.inflow += amount;
    }
    let value = 0;
    const unpriced = new Set<string>();
    for (const k of keys) {
      const quantity = quantities.get(k) ?? 0;
      if (quantity <= 0) continue;
      const trade = symbolOf.get(k);
      const close = closes.get(k)?.[i] ?? null;
      const rate = trade ? (rates.get(trade.currency)?.[i] ?? null) : null;
      if (close == null || rate == null) {
        missing.add(
          close == null ? (trade?.symbol ?? k) : (trade?.currency ?? k),
        );
        unpriced.add(k);
        continue;
      }
      const amount = quantity * close * rate;
      value += amount;
      entry(k).value = amount;
    }
    rows.push({ day, value, byKey, unpriced });
  });

  // A position without a price on either side of a day (not yet listed, a gap
  // in a thin listing) would enter or leave the total as a fake gain or loss,
  // so it is left out of that day's change and of the capital it is measured
  // against.
  const keyChange = (i: number, k: string): number | null => {
    if (rows[i].unpriced.has(k) || rows[i - 1].unpriced.has(k)) return null;
    const now = rows[i].byKey.get(k);
    const before = rows[i - 1].byKey.get(k);
    if (!now && !before) return null;
    return (now?.value ?? 0) - (before?.value ?? 0) - (now?.flow ?? 0);
  };
  const day = (i: number) => {
    let change = 0;
    let capital = 0;
    for (const k of keys) {
      const moved = keyChange(i, k);
      if (moved == null) continue;
      change += moved;
      capital +=
        (rows[i - 1].byKey.get(k)?.value ?? 0) +
        (rows[i].byKey.get(k)?.inflow ?? 0);
    }
    return { change, capital };
  };
  const flowsOn = (row: Row) =>
    [...row.byKey.values()].reduce((sum, k) => sum + k.flow, 0);

  const hasBaseline = rows.length > 0 && rows[0].day < input.from;
  const daily = rows.flatMap((row, i) => {
    if (i === 0 && hasBaseline) return [];
    const measured = i > 0 ? day(i) : null;
    return [
      {
        date: isoDay(row.day),
        value: round(row.value),
        flows: round(flowsOn(row)),
        change: measured ? round(measured.change) : null,
        changePercent: measured ? pct(measured.change, measured.capital) : null,
      },
    ];
  });

  let growth = 1;
  let pnl = 0;
  let netFlows = 0;
  for (let i = 1; i < rows.length; i++) {
    const { change, capital } = day(i);
    pnl += change;
    netFlows += flowsOn(rows[i]);
    if (capital > 0) growth *= 1 + change / capital;
  }
  const ranked = daily.flatMap((row) =>
    row.change != null && row.changePercent != null
      ? [{ ...row, change: row.change }]
      : [],
  );
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
  const start = rows[0];
  const end = rows.at(-1);
  const startCapital = (start?.value ?? 0) + Math.max(netFlows, 0);
  const positions = [...pnlByKey]
    .map(([k, amount]) => ({
      symbol: symbolOf.get(k)?.symbol ?? k,
      currency: symbolOf.get(k)?.currency ?? "",
      pnl: round(amount),
      contributionPercent: pct(amount, startCapital),
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  const focusIndex =
    input.focus == null ? -1 : rows.findIndex((row) => row.day === input.focus);
  const focusRow = focusIndex >= 0 ? rows[focusIndex] : null;
  const focusDay = focusIndex > 0 ? day(focusIndex) : null;
  const focusPositions =
    focusIndex > 0
      ? keys
          .flatMap((k) => {
            const change = keyChange(focusIndex, k);
            if (change == null) return [];
            const close = closes.get(k);
            const today = close?.[focusIndex] ?? null;
            const prior = close?.[focusIndex - 1] ?? null;
            return [
              {
                symbol: symbolOf.get(k)?.symbol ?? k,
                change: round(change),
                priceChangePercent:
                  today != null && prior
                    ? round((today / prior - 1) * 100)
                    : null,
                stale: today != null && prior != null && today === prior,
              },
            ];
          })
          .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      : [];
  const focus = focusRow
    ? {
        date: isoDay(focusRow.day),
        previousDate: focusIndex > 0 ? isoDay(rows[focusIndex - 1].day) : null,
        value: round(focusRow.value),
        change: focusDay ? round(focusDay.change) : null,
        changePercent: focusDay ? pct(focusDay.change, focusDay.capital) : null,
        positions: focusPositions,
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

export type CostLot = {
  symbol: string;
  currency: string;
  quantity: number;
  costLocal: number;
  costBase: number;
  /** Some buys had no trade-date FX rate, so costBase is not the whole cost. */
  incomplete: boolean;
};

/**
 * Average-cost basis per book (a sale in one book never consumes another's
 * cost), converting each buy at its own trade-date FX rate. Lots of the same
 * position in several books are combined only after each book's sales.
 */
export function fxInclusiveCost(
  trades: Trade[],
  fx: Map<string, ChartPoint[]>,
  base: string,
) {
  type Lot = CostLot & { key: string };
  const lots = new Map<string, Lot>();
  const missing = new Set<string>();
  const lotOf = (trade: Trade) => {
    const id = `${trade.bookId}|${positionKey(trade)}`;
    const found = lots.get(id) ?? {
      key: positionKey(trade),
      symbol: trade.symbol,
      currency: trade.currency,
      quantity: 0,
      costLocal: 0,
      costBase: 0,
      incomplete: false,
    };
    lots.set(id, found);
    return found;
  };
  for (const event of events(trades)) {
    const { trade } = event;
    const lot = lotOf(trade);
    if (trade.side === "buy") {
      const rate =
        trade.currency === base
          ? 1
          : closesOn(fx.get(trade.currency) ?? [], [event.day])[0];
      const cost = trade.quantity * trade.price + trade.fees;
      lot.quantity += trade.quantity;
      lot.costLocal += cost;
      if (rate == null) {
        lot.incomplete = true;
        missing.add(trade.currency);
      } else lot.costBase += cost * rate;
      continue;
    }
    if (lot.quantity <= 0) continue;
    const share = Math.min(1, trade.quantity / lot.quantity);
    lot.costLocal -= lot.costLocal * share;
    lot.costBase -= lot.costBase * share;
    lot.quantity -= trade.quantity;
    if (lot.quantity <= 1e-8) {
      lot.quantity = 0;
      lot.costLocal = 0;
      lot.costBase = 0;
      lot.incomplete = false;
    }
  }
  const combined = new Map<string, CostLot>();
  for (const lot of lots.values()) {
    if (lot.quantity <= 0) continue;
    const sum = combined.get(lot.key);
    combined.set(lot.key, {
      symbol: lot.symbol,
      currency: lot.currency,
      quantity: (sum?.quantity ?? 0) + lot.quantity,
      costLocal: (sum?.costLocal ?? 0) + lot.costLocal,
      costBase: (sum?.costBase ?? 0) + lot.costBase,
      incomplete: (sum?.incomplete ?? false) || lot.incomplete,
    });
  }
  return { lots: combined, missing: [...missing] };
}
