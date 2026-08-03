import {
  buildContributionSeries,
  buildPositions,
  buildValuationCurve,
  CASH_TICKER,
  computeMetrics,
  replayTrades,
  synthesizeActionTrades,
} from "@repo/markets/core";
import type {
  Portfolio,
  PortfolioInput,
  PortfolioPerformance,
  Trade,
  TradeInput,
  TradeSource,
} from "@repo/markets/schemas";
import { Types } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  type IMarketPortfolio,
  type IMarketTrade,
  MarketPortfolio,
  MarketPortfolioSnapshot,
  MarketTrade,
} from "@/models/Market";
import { getStores } from "./service";

/** Trades the owner typed. The rest are derived from cached corporate actions. */
export const OWNER_ENTERED_SOURCES: TradeSource[] = [
  "manual",
  "deposit",
  "withdrawal",
];

function toPortfolio(doc: IMarketPortfolio): Portfolio {
  return {
    id: String(doc._id),
    name: doc.name,
    baseCurrency: doc.baseCurrency,
    initialCash: doc.initialCash,
    benchmark: doc.benchmark,
    reinvestDividends: doc.reinvestDividends,
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

export async function updatePortfolio(
  id: string,
  input: Partial<PortfolioInput>,
): Promise<Portfolio | null> {
  await connectDB();
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
  ]);
  return true;
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
  // Everything the owner entered survives a sync; only dividend and split rows
  // are regenerated. Cash movements would otherwise be wiped on every rebuild.
  const manualDocs = await MarketTrade.find({
    portfolioId,
    source: { $in: OWNER_ENTERED_SOURCES },
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
  await MarketTrade.deleteMany({
    portfolioId,
    source: { $nin: OWNER_ENTERED_SOURCES },
    actionKey: { $nin: generated.map((trade) => trade.id) },
  });
  return generated.length;
}

export async function getPerformance(
  portfolioId: string,
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

  // Raw closes, keyed by ticker then date. Splits already exist as trades, so
  // adjusted prices here would count every split a second time.
  const closes = new Map<string, Map<string, number>>();
  const tradingDays = new Set<string>();
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
    const byDate = new Map<string, number>();
    for (const bar of barsByTicker[index] ?? []) {
      byDate.set(bar.date, bar.close);
      tradingDays.add(bar.date);
    }
    closes.set(ticker, byDate);
  });
  for (const bar of benchmarkBars) tradingDays.add(bar.date);

  const dates = [...tradingDays].sort();
  const priceOn = (ticker: string, date: string) =>
    closes.get(ticker)?.get(date) ?? null;
  const curve = buildValuationCurve(portfolio, trades, dates, priceOn);
  const contributions = buildContributionSeries(
    portfolio,
    trades,
    dates,
    priceOn,
  );

  const state = replayTrades(trades, portfolio.initialCash);
  const quotes = await stores.quotes.getQuotes(tickers);
  const quoteByTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));
  const lastDate = dates.at(-1);
  const previousDate = dates.at(-2);

  const positions = buildPositions(
    state,
    (ticker) =>
      quoteByTicker.get(ticker)?.last ??
      (lastDate ? (closes.get(ticker)?.get(lastDate) ?? null) : null),
    (ticker) =>
      quoteByTicker.get(ticker)?.prevClose ??
      (previousDate ? (closes.get(ticker)?.get(previousDate) ?? null) : null),
  );

  const benchmarkCurve = benchmarkBars.map((bar) => ({
    date: bar.date,
    value: bar.adjClose,
  }));

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
  };
}
