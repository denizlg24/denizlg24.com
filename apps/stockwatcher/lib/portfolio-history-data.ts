import "server-only";
import { majorOf, pairOf } from "./fx-rates";
import { type History, history } from "./market";
import type { ChartPoint, Trade, Workspace } from "./models";
import {
  buildPortfolioHistory,
  fxInclusiveCost,
  positionKey,
} from "./portfolio-history";
import { closesOn, dayOf, isoDay, parseDay } from "./portfolio-risk";

const maxRows = 66;
const concurrency = 6;
const source = "Yahoo Finance";
const today = () => Math.floor(Date.now() / 86_400_000);

/** Runs `work` over `items` with at most `limit` calls in flight. */
async function pool<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

const empty: History = {
  symbol: "",
  name: null,
  currency: null,
  points: [],
  splits: [],
};

const fetchHistory = (symbol: string, years: number) =>
  history(symbol, years, "1d", { adjusted: false }).catch(() => empty);

const invert = (points: ChartPoint[]) =>
  points.flatMap((point) =>
    point.close > 0 ? [{ ...point, close: 1 / point.close }] : [],
  );

const flat = (day: number, value: number): ChartPoint => ({
  time: day * 86_400,
  open: value,
  high: value,
  low: value,
  close: value,
  volume: null,
});

/** Base-currency value of one unit of `currency`, day by day. */
async function fxSeries(currency: string, base: string, years: number) {
  const { major, divisor } = majorOf(currency);
  const scale = (points: ChartPoint[]) =>
    points.map((point) => ({ ...point, close: point.close / divisor }));
  if (major === base) return scale([flat(0, 1)]);
  const bars = async (symbol: string) =>
    (await fetchHistory(symbol, years)).points;
  const direct = await bars(pairOf(major, base));
  if (direct.length) return scale(direct);
  const inverse = await bars(pairOf(base, major));
  if (inverse.length) return scale(invert(inverse));
  const legA = major === "USD" ? null : await bars(pairOf(major, "USD"));
  const legB = base === "USD" ? null : await bars(pairOf("USD", base));
  if ((legA && !legA.length) || (legB && !legB.length)) return [];
  const days = [
    ...new Set([...(legA ?? []), ...(legB ?? [])].map((p) => dayOf(p.time))),
  ].sort((a, b) => a - b);
  const a = legA ? closesOn(legA, days) : days.map(() => 1);
  const b = legB ? closesOn(legB, days) : days.map(() => 1);
  return scale(
    days.flatMap((day, i) => {
      const x = a[i];
      const y = b[i];
      return x != null && y != null ? [flat(day, x * y)] : [];
    }),
  );
}

/**
 * Factor that turns a price quoted in `quoted` into the trade's unit (GBp
 * quote, GBP trade: 1/100), or null when the units are different currencies.
 */
function unitFactor(quoted: string | null, traded: string) {
  if (!quoted || quoted === traded) return 1;
  const q = majorOf(quoted);
  const t = majorOf(traded);
  return q.major === t.major ? t.divisor / q.divisor : null;
}

/** Product of the split factors after `day`: pre-split shares → today's shares. */
const splitFactor = (splits: History["splits"], day: number) =>
  splits.reduce(
    (product, split) =>
      dayOf(split.time) > day ? product * split.factor : product,
    1,
  );

/** Restates a trade in today's share units, which Yahoo's closes use. */
function restate(trade: Trade, splits: History["splits"]): Trade {
  const factor = splitFactor(splits, parseDay(trade.date));
  return factor === 1
    ? trade
    : {
        ...trade,
        quantity: trade.quantity * factor,
        price: trade.price / factor,
      };
}

/** Evenly spaced rows across the whole window, always keeping the first and last. */
function sample<T>(rows: T[]) {
  if (rows.length <= maxRows) return { rows, sampled: null };
  const step = Math.ceil((rows.length - 1) / (maxRows - 1));
  const kept = rows.filter((_, i) => i % step === 0);
  const last = rows.at(-1);
  if (last && kept.at(-1) !== last) kept.push(last);
  return { rows: kept, sampled: `every ${step} trading days` };
}

export async function portfolioHistory(
  workspace: Workspace,
  options: { bookId?: string; from?: string; to?: string; date?: string },
) {
  const books = options.bookId
    ? workspace.books.filter((book) => book.id === options.bookId)
    : workspace.books;
  if (options.bookId && !books.length)
    throw new Error("That portfolio does not exist.");
  const ids = new Set(books.map((book) => book.id));
  const booked = workspace.trades.filter((trade) => ids.has(trade.bookId));
  if (!booked.length) throw new Error("There are no trades to rebuild.");
  const base = workspace.settings.baseCurrency;
  // A broker-synced book is a position snapshot in today's share units: each
  // position is one synthetic buy dated at its open date when the Flex query
  // reports one, else at the statement date.
  const snapshotAsOf = new Map(
    books.flatMap((book) =>
      book.broker ? [[book.id, parseDay(book.broker.asOf)] as const] : [],
    ),
  );

  const now = today();
  const to = Math.min(options.to ? parseDay(options.to) : now, now);
  const focus = options.date ? parseDay(options.date) : undefined;
  const from = options.from
    ? parseDay(options.from)
    : focus != null
      ? focus - 10
      : to - 30;
  if (from > to) throw new Error("from must be on or before to.");
  // Well before the trading day that serves as the window's baseline, so a
  // snapshot position is already held there and never enters as a buy.
  const heldSince = from - 15;
  const earliest = Math.min(
    heldSince,
    ...booked.map((trade) => parseDay(trade.date)),
  );
  const years = Math.min(25, Math.max(0.1, (now - earliest + 10) / 365));

  const symbols = [...new Set(booked.map((trade) => trade.symbol))];
  const currencies = [
    ...new Set(booked.map((t) => t.currency).filter((c) => c !== base)),
  ];
  const [histories, fxList] = await Promise.all([
    pool(symbols, concurrency, (symbol) => fetchHistory(symbol, years)),
    pool(currencies, concurrency, (c) => fxSeries(c, base, years)),
  ]);
  const bySymbol = new Map(symbols.map((s, i) => [s, histories[i]]));
  const fx = new Map(currencies.map((c, i) => [c, fxList[i]]));

  const prices = new Map<string, ChartPoint[]>();
  const incompatible: { symbol: string; reason: string }[] = [];
  for (const trade of booked) {
    const key = positionKey(trade);
    if (prices.has(key)) continue;
    const found = bySymbol.get(trade.symbol) ?? empty;
    const factor = unitFactor(found.currency, trade.currency);
    if (factor == null) {
      incompatible.push({
        symbol: trade.symbol,
        reason: `quoted in ${found.currency}, traded in ${trade.currency}`,
      });
      prices.set(key, []);
      continue;
    }
    prices.set(
      key,
      factor === 1
        ? found.points
        : found.points.map((p) => ({ ...p, close: p.close * factor })),
    );
  }

  const splitsOf = (trade: Trade) => bySymbol.get(trade.symbol)?.splits ?? [];
  const trades = booked.map((trade) =>
    snapshotAsOf.has(trade.bookId)
      ? { ...trade, date: isoDay(Math.min(parseDay(trade.date), heldSince)) }
      : restate(trade, splitsOf(trade)),
  );
  const built = buildPortfolioHistory({
    base,
    trades,
    prices,
    fx,
    from,
    to,
    focus,
  });
  if (!built.days.some((day) => day.value > 0))
    throw new Error(
      `No price history is available for these holdings right now${built.missing.length ? ` (missing: ${built.missing.join(", ")})` : ""}.`,
    );
  const { rows, sampled } = sample(built.days);

  // Cost needs a real purchase date: snapshot positions without one have
  // none, and a snapshot's quantity is already in today's share units.
  const undated: string[] = [];
  const datedCost = booked.flatMap((trade) => {
    const asOf = snapshotAsOf.get(trade.bookId);
    if (asOf == null) return [restate(trade, splitsOf(trade))];
    if (parseDay(trade.date) < asOf) return [trade];
    undated.push(trade.symbol);
    return [];
  });
  const { lots, missing: missingFx } = fxInclusiveCost(datedCost, fx, base);
  const excluded = [...new Set(undated)].map((symbol) => ({
    symbol,
    reason: "unknown purchase date",
  }));
  let value = 0;
  let costBase = 0;
  let localPnl = 0;
  let priceAsOf = 0;
  let fxAsOf = 0;
  for (const [key, lot] of lots) {
    const close = prices.get(key)?.at(-1);
    const rate =
      lot.currency === base
        ? { close: 1, time: 0 }
        : (fx.get(lot.currency)?.at(-1) ?? null);
    if (!close || !rate || lot.incomplete) {
      excluded.push({
        symbol: lot.symbol,
        reason: lot.incomplete
          ? "no FX rate on a purchase date"
          : !close
            ? "no current price"
            : `no ${lot.currency} FX rate`,
      });
      continue;
    }
    value += lot.quantity * close.close * rate.close;
    costBase += lot.costBase;
    localPnl += (lot.quantity * close.close - lot.costLocal) * rate.close;
    priceAsOf = Math.max(priceAsOf, close.time);
    fxAsOf = Math.max(fxAsOf, rate.time);
  }
  const unrealized = value - costBase;
  const r = (n: number) => Math.round(n * 100) / 100;
  const known = costBase > 0;
  const stamp = (time: number) =>
    time > 0 ? new Date(time * 1000).toISOString() : null;

  return {
    ...built,
    days: rows,
    sampled,
    source,
    asOf: built.to,
    incompatible,
    costBasis: {
      currency: base,
      complete: known && excluded.length === 0,
      value: known ? r(value) : null,
      cost: known ? r(costBase) : null,
      unrealized: known ? r(unrealized) : null,
      unrealizedPercent: known ? r((unrealized / costBase) * 100) : null,
      priceEffect: known ? r(localPnl) : null,
      fxEffect: known ? r(unrealized - localPnl) : null,
      excluded,
      missingFx,
      priceAsOf: stamp(priceAsOf),
      fxAsOf: stamp(fxAsOf),
      source,
    },
    assumptions: snapshotAsOf.size
      ? "Broker-synced positions are snapshots without trade history, so they are valued as held at today's size throughout the window; their cost basis is left out when the statement gives no open date."
      : null,
    method: `Holdings rebuilt from trades as of each day, valued at that day's close (split-adjusted, not dividend-adjusted; trades restated to today's share units across splits, prices converted to the trade's unit for pence/cents listings) and converted to ${base} at that day's FX close; today uses the latest price. A buy counts as capital from the start of its day, a sale leaves at the end of it. Day change excludes money moved in by trades and any position without a price on either side of the day; the time-weighted return chains those daily changes. Dividends are not tracked. costBasis converts each buy at its own trade-date FX rate (average cost per book), so fxEffect is the currency gain or loss since purchase; excluded lists holdings left out of it.`,
    window: { from: isoDay(from), to: isoDay(to) },
  };
}
