import "server-only";
import { majorOf, pairOf } from "./fx-rates";
import { history } from "./market";
import type { ChartPoint, Workspace } from "./models";
import { buildPortfolioHistory, fxInclusiveCost } from "./portfolio-history";
import { closesOn, dayOf, isoDay, parseDay } from "./portfolio-risk";

const maxRows = 66;
const today = () => Math.floor(Date.now() / 86_400_000);

async function bars(symbol: string, years: number) {
  return (
    (await history(symbol, years, "1d", { adjusted: false }).catch(() => null))
      ?.points ?? []
  );
}

const invert = (points: ChartPoint[]) =>
  points.flatMap((point) =>
    point.close > 0 ? [{ ...point, close: 1 / point.close }] : [],
  );

/** Base-currency value of one unit of `currency`, day by day. */
async function fxSeries(currency: string, base: string, years: number) {
  const { major, divisor } = majorOf(currency);
  const scale = (points: ChartPoint[]) =>
    divisor === 1
      ? points
      : points.map((point) => ({ ...point, close: point.close / divisor }));
  if (major === base)
    return scale([
      { time: 0, open: 1, high: 1, low: 1, close: 1, volume: null },
    ]);
  const direct = await bars(pairOf(major, base), years);
  if (direct.length) return scale(direct);
  const inverse = await bars(pairOf(base, major), years);
  if (inverse.length) return scale(invert(inverse));
  const [toUsd, fromUsd] = await Promise.all([
    major === "USD" ? null : bars(pairOf(major, "USD"), years),
    base === "USD" ? null : bars(pairOf("USD", base), years),
  ]);
  const legA = toUsd ?? [];
  const legB = fromUsd ?? [];
  if ((major !== "USD" && !legA.length) || (base !== "USD" && !legB.length))
    return [];
  const days = [
    ...new Set([...legA, ...legB].map((point) => dayOf(point.time))),
  ].sort((a, b) => a - b);
  const a = major === "USD" ? days.map(() => 1) : closesOn(legA, days);
  const b = base === "USD" ? days.map(() => 1) : closesOn(legB, days);
  return scale(
    days.flatMap((day, i) => {
      const x = a[i];
      const y = b[i];
      return x != null && y != null
        ? [
            {
              time: day * 86_400,
              open: x * y,
              high: x * y,
              low: x * y,
              close: x * y,
              volume: null,
            },
          ]
        : [];
    }),
  );
}

/** Keeps the last trading day of each week once a window is too long to list daily. */
function sample<T extends { date: string }>(rows: T[]) {
  if (rows.length <= maxRows) return { rows, sampled: null };
  const byWeek = new Map<number, T>();
  for (const row of rows) {
    const day = parseDay(row.date);
    byWeek.set(Math.floor((day + 3) / 7), row);
  }
  return { rows: [...byWeek.values()].slice(-maxRows), sampled: "weekly" };
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
  // A broker-synced book is a position snapshot: each position is one
  // synthetic buy dated at its open date when the Flex query reports one,
  // else at the statement date.
  const snapshotAsOf = new Map(
    books.flatMap((book) =>
      book.broker ? [[book.id, parseDay(book.broker.asOf)] as const] : [],
    ),
  );

  const to = Math.min(options.to ? parseDay(options.to) : today(), today());
  const focus = options.date ? parseDay(options.date) : undefined;
  const from = options.from
    ? parseDay(options.from)
    : focus != null
      ? focus - 10
      : to - 30;
  if (from > to) throw new Error("from must be on or before to.");
  const trades = booked.map((trade) =>
    snapshotAsOf.has(trade.bookId)
      ? { ...trade, date: isoDay(Math.min(parseDay(trade.date), from - 1)) }
      : trade,
  );
  const datedCost = booked.filter((trade) => {
    const asOf = snapshotAsOf.get(trade.bookId);
    return asOf == null || parseDay(trade.date) < asOf;
  });
  const undated = [
    ...new Set(
      booked
        .filter((trade) => !datedCost.includes(trade))
        .map((trade) => trade.symbol),
    ),
  ];
  const earliest = Math.min(
    from,
    ...booked.map((trade) => parseDay(trade.date)),
  );
  const years = Math.min(25, Math.max(0.1, (today() - earliest + 10) / 365));

  const keys = [
    ...new Map(trades.map((t) => [`${t.symbol}:${t.currency}`, t])).values(),
  ];
  const currencies = [
    ...new Set(trades.map((trade) => trade.currency).filter((c) => c !== base)),
  ];
  const [priceList, fxList] = await Promise.all([
    Promise.all(keys.map((trade) => bars(trade.symbol, years))),
    Promise.all(currencies.map((currency) => fxSeries(currency, base, years))),
  ]);
  const prices = new Map(
    keys.map((trade, i) => [`${trade.symbol}:${trade.currency}`, priceList[i]]),
  );
  const fx = new Map(currencies.map((currency, i) => [currency, fxList[i]]));

  const built = buildPortfolioHistory({
    base,
    trades,
    prices,
    fx,
    from,
    to,
    focus,
  });
  const { rows, sampled } = sample(built.days);

  const { lots, missing: costMissing } = fxInclusiveCost(datedCost, fx, base);
  let value = 0;
  let costBase = 0;
  let localPnlAtToday = 0;
  for (const [key, lot] of lots) {
    if (lot.quantity <= 0) continue;
    const points = prices.get(key) ?? [];
    const close = points.at(-1)?.close;
    const rate =
      lot.currency === base ? 1 : (fx.get(lot.currency)?.at(-1)?.close ?? null);
    if (close == null || rate == null) continue;
    value += lot.quantity * close * rate;
    costBase += lot.costBase;
    localPnlAtToday += (lot.quantity * close - lot.costLocal) * rate;
  }
  const unrealized = value - costBase;
  const r = (n: number) => Math.round(n * 100) / 100;

  return {
    ...built,
    days: rows,
    sampled,
    costBasis: {
      currency: base,
      value: costBase > 0 ? r(value) : null,
      cost: costBase > 0 ? r(costBase) : null,
      unrealized: costBase > 0 ? r(unrealized) : null,
      unrealizedPercent: costBase > 0 ? r((unrealized / costBase) * 100) : null,
      priceEffect: costBase > 0 ? r(localPnlAtToday) : null,
      fxEffect: costBase > 0 ? r(unrealized - localPnlAtToday) : null,
      missingFx: costMissing,
      unknownPurchaseDate: undated,
    },
    assumptions: snapshotAsOf.size
      ? "Broker-synced positions are snapshots without trade history, so they are valued as held at today's size throughout the window; their cost basis is left out of the FX split when the statement gives no open date (unknownPurchaseDate)."
      : null,
    method: `Holdings rebuilt from trades as of each day, valued at that day's traded (unadjusted) close and converted to ${base} at that day's FX close; today uses the latest price. Day change excludes money moved in or out by trades; the time-weighted return chains those daily changes. Dividends are not tracked, so they are not in P&L. costBasis converts each buy at its own trade-date FX rate, so fxEffect is the currency gain or loss since purchase.`,
    window: { from: isoDay(from), to: isoDay(to) },
  };
}
