import {
  buildContributionSeries,
  buildPositions,
  buildValuationCurve,
  CASH_TICKER,
  computeMargin,
  computeMetrics,
  performanceDates,
  replayTrades,
  synthesizeActionTrades,
  toDateKey,
} from "@repo/markets/core";
import type {
  MarginConfig,
  Portfolio,
  PortfolioInput,
  PortfolioPerformance,
  Trade,
  TradeInput,
  TradeSource,
  ValuePoint,
} from "@repo/markets/schemas";
import { DEFAULT_MARGIN } from "@repo/markets/schemas";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  type IMarketPortfolio,
  type IMarketTrade,
  MarketPortfolio,
  MarketPortfolioSnapshot,
  MarketPortfolioValuePoint,
  MarketTrade,
} from "@/models/Market";
import { getCandles, getQuotes, getStores } from "./service";

/**
 * Trades the owner typed. The rest are derived from cached corporate actions,
 * booked by the order engine, or accrued as borrow — all of them regenerable,
 * and none of them the owner's to edit by hand.
 */
export const OWNER_ENTERED_SOURCES: TradeSource[] = [
  "manual",
  "deposit",
  "withdrawal",
];

/**
 * Everything a corporate-action sync must leave alone. Order fills and borrow
 * charges are as real as a typed trade — they just were not typed — and
 * rebuilding the action rows must never take them with it. Treating "not
 * owner-entered" as "regenerable" would delete the entire automated book on the
 * next sync.
 */
export const LEDGER_SOURCES: TradeSource[] = [
  ...OWNER_ENTERED_SOURCES,
  "order",
  "borrow",
  "liquidation",
];

/** The rows `syncPortfolioActions` owns outright and rebuilds every run. */
export const GENERATED_ACTION_SOURCES: TradeSource[] = [
  "dividend",
  "drip",
  "split",
];

/**
 * Portfolios created before margin existed carry no subdocument, and a missing
 * requirement would read as a zero requirement — infinite buying power and a
 * margin call that can never fire.
 */
export function marginConfigOf(doc: IMarketPortfolio): MarginConfig {
  const stored = doc.margin;
  if (!stored) return DEFAULT_MARGIN;
  return {
    enabled: stored.enabled ?? DEFAULT_MARGIN.enabled,
    initialLong: stored.initialLong ?? DEFAULT_MARGIN.initialLong,
    initialShort: stored.initialShort ?? DEFAULT_MARGIN.initialShort,
    maintenanceLong: stored.maintenanceLong ?? DEFAULT_MARGIN.maintenanceLong,
    maintenanceShort:
      stored.maintenanceShort ?? DEFAULT_MARGIN.maintenanceShort,
    borrowRate: stored.borrowRate ?? DEFAULT_MARGIN.borrowRate,
  };
}

function toPortfolio(doc: IMarketPortfolio): Portfolio {
  return {
    id: String(doc._id),
    name: doc.name,
    baseCurrency: doc.baseCurrency,
    initialCash: doc.initialCash,
    benchmark: doc.benchmark,
    reinvestDividends: doc.reinvestDividends,
    allowShorts: doc.allowShorts ?? false,
    margin: marginConfigOf(doc),
    inceptionDate: doc.inceptionDate,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function toTrade(doc: IMarketTrade): Trade {
  return {
    id: String(doc._id),
    portfolioId: String(doc.portfolioId),
    ticker: doc.ticker,
    side: doc.side,
    quantity: doc.quantity,
    price: doc.price,
    fees: doc.fees,
    executedAt: doc.executedAt.toISOString(),
    source: doc.source as Trade["source"],
    note: doc.note ?? undefined,
    orderId: doc.orderId ? String(doc.orderId) : undefined,
  };
}

export async function listPortfolios(): Promise<Portfolio[]> {
  await connectDB();
  const docs = await MarketPortfolio.find().sort({ createdAt: 1 });
  return docs.map(toPortfolio);
}

export async function getPortfolio(id: string): Promise<Portfolio | null> {
  await connectDB();
  const doc = await MarketPortfolio.findById(id);
  return doc ? toPortfolio(doc) : null;
}

export async function createPortfolio(
  input: PortfolioInput,
): Promise<Portfolio> {
  await connectDB();
  const doc = await MarketPortfolio.create(input);
  return toPortfolio(doc);
}

export class PortfolioRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioRejected";
  }
}

export async function updatePortfolio(
  id: string,
  input: Partial<PortfolioInput>,
): Promise<Portfolio | null> {
  await connectDB();
  // Turning shorting off while a short is open does not change a setting, it
  // rewrites history. The replay reads the flag as it stands now, so the
  // original opening sale re-runs with nothing allowed to open, settles
  // nothing, and the position, its proceeds and its realised PnL disappear from
  // every curve point and metric that used to include them.
  if (input.allowShorts === false) {
    const performance = await getPerformance(id);
    const short = performance?.positions.find(
      (position) => position.quantity < 0,
    );
    if (short) {
      throw new PortfolioRejected(
        `${short.ticker} is short; cover it before turning shorting off`,
      );
    }
  }
  const doc = await MarketPortfolio.findByIdAndUpdate(id, input, {
    returnDocument: "after",
  });
  return doc ? toPortfolio(doc) : null;
}

export async function deletePortfolio(id: string): Promise<boolean> {
  await connectDB();
  const result = await MarketPortfolio.findByIdAndDelete(id);
  if (!result) return false;
  await Promise.all([
    MarketTrade.deleteMany({ portfolioId: id }),
    // Nothing else ever removes these, so leaving them behind grows the
    // collection without bound and keeps rows pointing at a dead portfolio.
    MarketPortfolioSnapshot.deleteMany({ portfolioId: id }),
    // Value points do expire on their own, but a month of orphans pointing at a
    // portfolio that no longer exists is still a month of them.
    MarketPortfolioValuePoint.deleteMany({ portfolioId: id }),
  ]);
  return true;
}

/** How much observed intraday history the performance payload carries. */
const INTRADAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A week of minute-resolution points is a little over ten thousand rows, which
 * is more than any chart can draw and more than the payload should carry. The
 * cap keeps a dense week bounded; the window is what makes it rare to hit.
 */
const INTRADAY_MAX_POINTS = 2_000;

/** Repeated reads inside one minute are the same observation, not many. */
function toMinute(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/**
 * Records what the book was worth at this moment.
 *
 * This is the whole intraday story. Reconstructing a curve within the session
 * would need intraday bars for every holding on every read — a provider request
 * per holding per minute against a fifty-an-hour cap — whereas `getPerformance`
 * has already priced the book off live quotes by the time it returns. Writing
 * that down costs one upsert and no budget at all.
 *
 * Called from the surfaces where a valuation means someone is watching or a
 * schedule fired, not from every internal `getPerformance` — the order engine
 * calls it several times a pass and those are the same instant.
 */
export async function recordValuePoint(
  portfolioId: string,
  performance: PortfolioPerformance,
  now = new Date(),
): Promise<void> {
  const latest = performance.curve.at(-1);
  if (!latest) return;
  await connectDB();
  await MarketPortfolioValuePoint.updateOne(
    { portfolioId: new Types.ObjectId(portfolioId), ts: toMinute(now) },
    {
      $set: {
        value: latest.value,
        cash: latest.cash,
        positionsValue: latest.positionsValue,
        invested: latest.invested,
      },
    },
    { upsert: true },
  );
}

export async function listTrades(portfolioId: string): Promise<Trade[]> {
  await connectDB();
  const docs = await MarketTrade.find({ portfolioId }).sort({ executedAt: 1 });
  return docs.map(toTrade);
}

export async function addTrade(
  portfolioId: string,
  input: TradeInput,
): Promise<Trade> {
  await connectDB();
  const doc = await MarketTrade.create({
    ...input,
    portfolioId,
    executedAt: new Date(input.executedAt),
  });
  return toTrade(doc);
}

export async function deleteTrade(
  portfolioId: string,
  tradeId: string,
): Promise<boolean> {
  await connectDB();
  const result = await MarketTrade.findOneAndDelete({
    _id: tradeId,
    portfolioId,
    // Dividends and splits are rebuilt from cached actions, so deleting one by
    // hand would only have it reappear on the next sync. Everything the owner
    // entered — trades and cash movements alike — is theirs to remove.
    source: { $in: ["manual", "deposit", "withdrawal"] },
  });
  return result !== null;
}

/**
 * Rebuilds the dividend and split trades for every ticker the portfolio has
 * ever held. Generated rows carry a deterministic `actionKey`, so a rerun
 * overwrites in place instead of paying the same dividend twice.
 */
export async function syncPortfolioActions(
  portfolioId: string,
): Promise<number> {
  await connectDB();
  const portfolio = await MarketPortfolio.findById(portfolioId);
  if (!portfolio) return 0;

  const stores = getStores();
  // The whole real ledger, not just what was typed: an action falls on the
  // shares an order filled exactly as it does on the shares the owner bought,
  // and replaying without the fills would compute a dividend against a position
  // the portfolio does not have.
  const manualDocs = await MarketTrade.find({
    portfolioId,
    source: { $in: LEDGER_SOURCES },
  });
  const manual = manualDocs.map(toTrade);
  const tickers = [
    ...new Set(
      manual
        .map((trade) => trade.ticker)
        .filter((ticker) => ticker !== CASH_TICKER),
    ),
  ];

  const perTicker = await Promise.all(
    tickers.map(async (ticker) => {
      const [actions, bars] = await Promise.all([
        stores.bars.getActions(ticker),
        stores.bars.getDailyBars(ticker),
      ]);
      const closes = new Map(bars.map((bar) => [bar.date, bar.close]));
      return synthesizeActionTrades({
        portfolioId,
        ticker,
        actions,
        manualTrades: manual,
        reinvestDividends: portfolio.reinvestDividends,
        allowShorts: portfolio.allowShorts ?? false,
        priceOn: (_ticker, date) => closes.get(date) ?? null,
      });
    }),
  );
  const generated: Trade[] = perTicker.flat();

  // Upsert on `actionKey` rather than delete-then-insert. A failed insert used
  // to leave the portfolio without any generated rows, and `getPerformance`
  // running concurrently with a sync could observe that empty intermediate
  // state.
  if (generated.length > 0) {
    const owner = new Types.ObjectId(portfolioId);
    await MarketTrade.bulkWrite(
      generated.map((trade) => ({
        updateOne: {
          filter: { portfolioId: owner, actionKey: trade.id },
          update: {
            $set: {
              portfolioId: owner,
              ticker: trade.ticker,
              side: trade.side,
              quantity: trade.quantity,
              price: trade.price,
              fees: trade.fees,
              executedAt: new Date(trade.executedAt),
              source: trade.source,
              note: trade.note ?? "",
              actionKey: trade.id,
            },
          },
          upsert: true,
        },
      })),
    );
  }
  // Scoped to the sources this function generates. Keyed on "not owner-entered"
  // it would also sweep away order fills and borrow charges, which nothing
  // regenerates.
  await MarketTrade.deleteMany({
    portfolioId,
    source: { $in: GENERATED_ACTION_SOURCES },
    actionKey: { $nin: generated.map((trade) => trade.id) },
  });
  return generated.length;
}

/**
 * Pulls daily history for a holding the cache has never seen.
 *
 * A position is priced entirely off cached bars, so a ticker bought before its
 * first cron pass has no curve and no market value at all until one runs. Only
 * symbols with no coverage whatsoever are fetched: keeping the daily delta warm
 * is cron's job, and doing it per page load would spend one request per holding
 * against a fifty-an-hour cap.
 */
async function backfillNewHoldings(tickers: string[]): Promise<void> {
  const stores = getStores();
  const cold: string[] = [];
  for (const ticker of tickers) {
    const coverage = await stores.bars.getCoverage(ticker, { kind: "daily" });
    if (!coverage.to) cold.push(ticker);
  }

  for (const ticker of cold) {
    try {
      await getCandles({ ticker, resolution: "1day", adjusted: false });
    } catch {
      // A cold holding that cannot be fetched stays unpriced, which the
      // positions table already renders as a dash. Failing the whole
      // performance read over one symbol would hide the rest of the portfolio.
    }
  }
}

export interface PerformanceOptions {
  /**
   * Off by default. The observed series is up to a week of minute-resolution
   * rows, and only the chart renders it — while `runOrderEngine` calls this
   * once a pass per portfolio and the cron loops it over all of them. Every one
   * of those calls would otherwise pay for the full scan and mapping.
   */
  intraday?: boolean;
}

export async function getPerformance(
  portfolioId: string,
  options: PerformanceOptions = {},
): Promise<PortfolioPerformance | null> {
  await connectDB();
  const portfolio = await MarketPortfolio.findById(portfolioId);
  if (!portfolio) return null;

  const stores = getStores();
  const trades = await listTrades(portfolioId);
  const tickers = [
    ...new Set(
      trades
        .map((trade) => trade.ticker)
        .filter((ticker) => ticker !== CASH_TICKER),
    ),
  ];

  await backfillNewHoldings(
    portfolio.benchmark ? [...tickers, portfolio.benchmark] : tickers,
  );

  // Raw closes, keyed by ticker then date. Splits already exist as trades, so
  // adjusted prices here would count every split a second time.
  const closes = new Map<string, Map<string, number>>();
  const tradingDays = new Set<string>();
  // Latest and second-latest close per ticker, so a holding with no live quote
  // still prices off its last print rather than off whatever date happens to sit
  // at the end of `dates` — which, now that today is always there, is a day the
  // bar cache does not reach until after the close.
  const latestClose = new Map<string, number>();
  const priorClose = new Map<string, number>();
  const [barsByTicker, benchmarkBars] = await Promise.all([
    Promise.all(
      tickers.map((ticker) =>
        stores.bars.getDailyBars(ticker, portfolio.inceptionDate),
      ),
    ),
    portfolio.benchmark
      ? stores.bars.getDailyBars(portfolio.benchmark, portfolio.inceptionDate)
      : Promise.resolve([]),
  ]);

  tickers.forEach((ticker, index) => {
    const bars = barsByTicker[index] ?? [];
    const byDate = new Map<string, number>();
    for (const bar of bars) {
      byDate.set(bar.date, bar.close);
      tradingDays.add(bar.date);
    }
    closes.set(ticker, byDate);
    const latest = bars.at(-1);
    if (latest) latestClose.set(ticker, latest.close);
    const prior = bars.at(-2);
    if (prior) priorClose.set(ticker, prior.close);
  });
  for (const bar of benchmarkBars) tradingDays.add(bar.date);

  const allowShorts = portfolio.allowShorts ?? false;
  const margin = marginConfigOf(portfolio);

  // Quotes are read before the curve is built, not after, because the curve's
  // final point is priced from them.
  //
  // Everything below exists because the curve used to be driven entirely by
  // cached daily bars, and a daily bar for today does not exist until after the
  // close. So the curve stopped at the previous session while `positions` were
  // already live — the header disagreed with the table beneath it, and "day"
  // P&L was yesterday's move. On a portfolio opened today there were no bars at
  // all: no curve, no contributions, and metrics falling back to bare cash, so a
  // book that had just bought stock reported only the cash it had left.
  const quoteTickers = portfolio.benchmark
    ? [...new Set([...tickers, portfolio.benchmark])]
    : tickers;
  // Refreshed rather than read straight from Mongo. A holding that is not on a
  // watchlist and not open in the markets view has nothing else driving its
  // quote, so cached-only reads left the portfolio valued at whatever the last
  // cron run wrote. This is the batched, TTL'd path — one provider request
  // covers every holding, and at most one every two minutes.
  const { quotes } = await getQuotes(quoteTickers).catch(async () => ({
    quotes: await stores.quotes.getQuotes(quoteTickers),
  }));
  const quoteByTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));

  const today = toDateKey(stores.clock.now());
  const dates = performanceDates({
    barDates: tradingDays,
    inceptionDate: portfolio.inceptionDate,
    today,
  });

  const priceOn = (ticker: string, date: string) => {
    // The live quote is the close-in-progress. Preferring the cached bar here
    // would pin today's point to yesterday even once a quote exists.
    if (date === today) {
      return (
        quoteByTicker.get(ticker)?.last ?? closes.get(ticker)?.get(date) ?? null
      );
    }
    return closes.get(ticker)?.get(date) ?? null;
  };
  const curveInput = { initialCash: portfolio.initialCash, allowShorts };
  const curve = buildValuationCurve(curveInput, trades, dates, priceOn);
  const contributions = buildContributionSeries(
    curveInput,
    trades,
    dates,
    priceOn,
  );

  const state = replayTrades(trades, portfolio.initialCash, undefined, {
    allowShorts,
  });

  const positions = buildPositions(
    state,
    (ticker) =>
      quoteByTicker.get(ticker)?.last ?? latestClose.get(ticker) ?? null,
    (ticker) =>
      quoteByTicker.get(ticker)?.prevClose ?? priorClose.get(ticker) ?? null,
    margin,
  );

  const benchmarkCurve = benchmarkBars.map((bar) => ({
    date: bar.date,
    value: bar.adjClose,
  }));
  // The benchmark gets the same live final point, or it would be measured to
  // yesterday while the portfolio is measured to now — which shows up as a
  // spurious day of out- or under-performance every session.
  //
  // Mixing a raw last into an adjusted series is safe only at the tip: back
  // adjustment is applied to older bars, so the newest `adjClose` is already the
  // raw close. Appending anywhere else would not be.
  const benchmarkLast = portfolio.benchmark
    ? (quoteByTicker.get(portfolio.benchmark)?.last ?? null)
    : null;
  if (benchmarkLast !== null && benchmarkCurve.at(-1)?.date !== today) {
    benchmarkCurve.push({ date: today, value: benchmarkLast });
  }

  // Newest first and then reversed, so the cap drops the far end of the window
  // rather than the part of it anyone is looking at.
  const observed = options.intraday
    ? (
        await MarketPortfolioValuePoint.find(
          {
            portfolioId: portfolio._id,
            ts: {
              $gte: new Date(stores.clock.now().getTime() - INTRADAY_WINDOW_MS),
            },
          },
          { ts: 1, value: 1, cash: 1, positionsValue: 1, invested: 1 },
        )
          .sort({ ts: -1 })
          .limit(INTRADAY_MAX_POINTS)
      ).reverse()
    : [];
  const intradayCurve: ValuePoint[] = observed.map((point) => {
    const totalPnl = point.value - point.invested;
    return {
      ts: point.ts.toISOString(),
      value: point.value,
      cash: point.cash,
      positionsValue: point.positionsValue,
      invested: point.invested,
      totalPnl,
      // Derived on read rather than stored: `invested` is what the row holds,
      // and a percentage recomputed from it can never drift from the value it
      // is a percentage of.
      totalPnlPercent:
        point.invested === 0 ? 0 : (totalPnl / point.invested) * 100,
    };
  });

  return {
    portfolioId,
    curve,
    benchmarkCurve,
    positions,
    contributions,
    metrics: computeMetrics({
      curve,
      benchmarkCurve,
      state,
      positions,
    }),
    margin: computeMargin({ cash: state.cash, positions, config: margin }),
    intradayCurve,
  };
}
