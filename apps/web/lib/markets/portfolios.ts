import {
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
} from "@repo/markets/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  type IMarketPortfolio,
  type IMarketTrade,
  MarketPortfolio,
  MarketTrade,
} from "@/models/Market";
import { getStores } from "./service";

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
  await MarketTrade.deleteMany({ portfolioId: id });
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
    // Generated rows are rebuilt from cached actions, so deleting one by hand
    // would only have it reappear on the next sync.
    source: "manual",
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
  const manualDocs = await MarketTrade.find({ portfolioId, source: "manual" });
  const manual = manualDocs.map(toTrade);
  const tickers = [
    ...new Set(
      manual
        .map((trade) => trade.ticker)
        .filter((ticker) => ticker !== CASH_TICKER),
    ),
  ];

  const generated: Trade[] = [];
  for (const ticker of tickers) {
    const [actions, bars] = await Promise.all([
      stores.bars.getActions(ticker),
      stores.bars.getDailyBars(ticker),
    ]);
    const closes = new Map(bars.map((bar) => [bar.date, bar.close]));
    generated.push(
      ...synthesizeActionTrades({
        portfolioId,
        ticker,
        actions,
        manualTrades: manual,
        reinvestDividends: portfolio.reinvestDividends,
        priceOn: (_ticker, date) => closes.get(date) ?? null,
      }),
    );
  }

  await MarketTrade.deleteMany({ portfolioId, source: { $ne: "manual" } });
  if (generated.length > 0) {
    await MarketTrade.insertMany(
      generated.map((trade) => ({
        portfolioId,
        ticker: trade.ticker,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fees: trade.fees,
        executedAt: new Date(trade.executedAt),
        source: trade.source,
        note: trade.note,
        actionKey: trade.id,
      })),
    );
  }
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
  for (const ticker of tickers) {
    const bars = await stores.bars.getDailyBars(
      ticker,
      portfolio.inceptionDate,
    );
    const byDate = new Map<string, number>();
    for (const bar of bars) {
      byDate.set(bar.date, bar.close);
      tradingDays.add(bar.date);
    }
    closes.set(ticker, byDate);
  }

  const benchmarkBars = portfolio.benchmark
    ? await stores.bars.getDailyBars(
        portfolio.benchmark,
        portfolio.inceptionDate,
      )
    : [];
  for (const bar of benchmarkBars) tradingDays.add(bar.date);

  const dates = [...tradingDays].sort();
  const curve = buildValuationCurve(
    portfolio,
    trades,
    dates,
    (ticker, date) => closes.get(ticker)?.get(date) ?? null,
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

  return {
    portfolioId,
    curve,
    benchmarkCurve: benchmarkBars.map((bar) => ({
      date: bar.date,
      value: bar.adjClose,
    })),
    positions,
    metrics: computeMetrics({
      curve,
      benchmarkCurve: benchmarkBars.map((bar) => ({
        date: bar.date,
        value: bar.adjClose,
      })),
      state,
      positions,
    }),
  };
}
