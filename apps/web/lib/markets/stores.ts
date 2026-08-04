import type {
  BarStore,
  CoverageDataset,
  FundamentalStore,
  MarketStores,
  QuoteStore,
  SymbolStore,
} from "@repo/markets/core";
import type { Resolution } from "@repo/markets/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  MarketAction,
  MarketCompanyProfile,
  MarketCoverage,
  MarketDailyBar,
  MarketFiling,
  MarketFundamental,
  MarketIntradayBar,
  MarketNews,
  MarketPortfolio,
  MarketQuote,
  MarketSymbolModel,
  MarketTrade,
  MarketWatchlist,
} from "@/models/Market";
import { createMongoBudget } from "./budget";

function datasetKey(dataset: CoverageDataset): string {
  return dataset.kind === "intraday"
    ? `intraday:${dataset.resolution}`
    : dataset.kind;
}

/**
 * Mongoose strips `undefined` from `$set`, so a field a provider stopped
 * returning would keep its previous value forever. Splitting the payload sends
 * the absent keys through `$unset` instead, which is what a refresh means.
 */
function setAndUnset(fields: Record<string, unknown>): {
  $set: Record<string, unknown>;
  $unset?: Record<string, "">;
} {
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) $unset[key] = "";
    else $set[key] = value;
  }
  return Object.keys($unset).length > 0 ? { $set, $unset } : { $set };
}

/** Intraday bars are disposable; a fine resolution is worth less for longer. */
const INTRADAY_TTL_DAYS: Partial<Record<Resolution, number>> = {
  "1min": 7,
  "5min": 30,
  "15min": 60,
  "30min": 90,
  "1hour": 180,
};

const symbols: SymbolStore = {
  async getSymbol(ticker) {
    await connectDB();
    const doc = await MarketSymbolModel.findOne({
      ticker: ticker.toUpperCase(),
    }).lean();
    if (!doc) return null;
    return {
      ticker: doc.ticker,
      name: doc.name,
      exchange: doc.exchange ?? undefined,
      assetType: doc.assetType as "stock",
      currency: doc.currency,
      cik: doc.cik ?? undefined,
      startDate: doc.startDate ?? undefined,
      endDate: doc.endDate ?? undefined,
      active: doc.active,
      updatedAt: doc.updatedAt.toISOString(),
    };
  },

  async upsertSymbols(next) {
    if (next.length === 0) return;
    await connectDB();
    await MarketSymbolModel.bulkWrite(
      next.map((symbol) => ({
        updateOne: {
          filter: { ticker: symbol.ticker },
          update: {
            $set: {
              name: symbol.name,
              exchange: symbol.exchange,
              assetType: symbol.assetType,
              currency: symbol.currency,
              cik: symbol.cik,
              startDate: symbol.startDate,
              endDate: symbol.endDate,
              active: symbol.active,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },

  async searchSymbols(query, limit) {
    await connectDB();
    const needle = query.trim().toUpperCase();
    if (!needle) return [];

    // Prefix matches first — typing "AAP" should surface AAPL before any
    // company whose name merely contains the letters.
    // The sanitizer keeps `.`, which is a regex wildcard — without escaping it
    // a search for BRK.B would also match BRKXB.
    const prefix = await MarketSymbolModel.find({
      ticker: new RegExp(
        `^${needle.replace(/[^A-Z0-9.\-:]/g, "").replace(/\./g, "\\.")}`,
      ),
      active: true,
    })
      .limit(limit)
      .lean();

    const results = prefix.map((doc) => ({
      ticker: doc.ticker,
      name: doc.name,
      exchange: doc.exchange ?? undefined,
      assetType: doc.assetType as "stock",
      score: doc.ticker === needle ? 100 : 50,
    }));
    if (results.length >= limit) return results;

    const seen = new Set(results.map((row) => row.ticker));
    const textMatches = await MarketSymbolModel.find(
      { $text: { $search: query }, active: true },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit - results.length + seen.size)
      .lean();

    for (const doc of textMatches) {
      if (seen.has(doc.ticker) || results.length >= limit) continue;
      results.push({
        ticker: doc.ticker,
        name: doc.name,
        exchange: doc.exchange ?? undefined,
        assetType: doc.assetType as "stock",
        score: 10,
      });
    }
    return results;
  },

  async countSymbols() {
    await connectDB();
    return MarketSymbolModel.estimatedDocumentCount();
  },

  async getProfile(ticker) {
    await connectDB();
    const doc = await MarketCompanyProfile.findOne({
      ticker: ticker.toUpperCase(),
    }).lean();
    if (!doc) return null;
    return {
      ticker: doc.ticker,
      name: doc.name,
      description: doc.description ?? undefined,
      sector: doc.sector ?? undefined,
      industry: doc.industry ?? undefined,
      country: doc.country ?? undefined,
      website: doc.website ?? undefined,
      logoUrl: doc.logoUrl ?? undefined,
      employees: doc.employees ?? undefined,
      marketCap: doc.marketCap ?? undefined,
      sharesOutstanding: doc.sharesOutstanding ?? undefined,
      ipoDate: doc.ipoDate ?? undefined,
      updatedAt: doc.updatedAt.toISOString(),
    };
  },

  async upsertProfile(profile) {
    await connectDB();
    await MarketCompanyProfile.updateOne(
      { ticker: profile.ticker.toUpperCase() },
      setAndUnset({ ...profile, ticker: profile.ticker.toUpperCase() }),
      { upsert: true },
    );
  },

  async listTrackedTickers() {
    await connectDB();
    const [watchlists, holdings, portfolios] = await Promise.all([
      MarketWatchlist.find().lean(),
      MarketTrade.distinct("ticker"),
      MarketPortfolio.find({ benchmark: { $ne: null } }).lean(),
    ]);
    const tracked = new Set<string>();
    for (const list of watchlists) {
      for (const ticker of list.tickers) tracked.add(ticker.toUpperCase());
    }
    for (const ticker of holdings as string[]) {
      if (ticker !== "CASH") tracked.add(ticker.toUpperCase());
    }
    for (const portfolio of portfolios) {
      if (portfolio.benchmark) tracked.add(portfolio.benchmark.toUpperCase());
    }
    return [...tracked];
  },
};

const bars: BarStore = {
  async getDailyBars(ticker, from, to) {
    await connectDB();
    const filter: Record<string, unknown> = { ticker: ticker.toUpperCase() };
    if (from || to) {
      filter.date = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    const docs = await MarketDailyBar.find(filter).sort({ date: 1 }).lean();
    return docs.map((doc) => ({
      date: doc.date,
      ts: doc.ts.toISOString(),
      open: doc.open,
      high: doc.high,
      low: doc.low,
      close: doc.close,
      volume: doc.volume,
      adjOpen: doc.adjOpen,
      adjHigh: doc.adjHigh,
      adjLow: doc.adjLow,
      adjClose: doc.adjClose,
      adjVolume: doc.adjVolume,
      divCash: doc.divCash,
      splitFactor: doc.splitFactor,
    }));
  },

  async upsertDailyBars(ticker, next) {
    if (next.length === 0) return;
    await connectDB();
    await MarketDailyBar.bulkWrite(
      next.map((bar) => ({
        updateOne: {
          filter: { ticker: ticker.toUpperCase(), date: bar.date },
          update: { $set: { ...bar, ts: new Date(bar.ts) } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },

  async getIntradayBars(ticker, resolution, from, to) {
    await connectDB();
    const filter: Record<string, unknown> = {
      ticker: ticker.toUpperCase(),
      resolution,
    };
    if (from || to) {
      filter.ts = {
        ...(from ? { $gte: new Date(`${from}T00:00:00.000Z`) } : {}),
        ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {}),
      };
    }
    const docs = await MarketIntradayBar.find(filter).sort({ ts: 1 }).lean();
    return docs.map((doc) => ({
      ts: doc.ts.toISOString(),
      open: doc.open,
      high: doc.high,
      low: doc.low,
      close: doc.close,
      volume: doc.volume,
    }));
  },

  async upsertIntradayBars(ticker, resolution, next) {
    if (next.length === 0) return;
    await connectDB();
    const ttlDays = INTRADAY_TTL_DAYS[resolution] ?? 30;
    await MarketIntradayBar.bulkWrite(
      next.map((bar) => {
        const ts = new Date(bar.ts);
        const expiresAt = new Date(ts);
        expiresAt.setUTCDate(expiresAt.getUTCDate() + ttlDays);
        return {
          updateOne: {
            filter: { ticker: ticker.toUpperCase(), resolution, ts },
            update: { $set: { ...bar, ts, resolution, expiresAt } },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  },

  async getCoverage(ticker, dataset) {
    await connectDB();
    const doc = await MarketCoverage.findOne({
      ticker: ticker.toUpperCase(),
      dataset: datasetKey(dataset),
    }).lean();
    return {
      from: doc?.from ?? null,
      to: doc?.to ?? null,
      fetchedAt: doc?.fetchedAt?.toISOString() ?? null,
      backfilled: doc?.backfilled ?? false,
    };
  },

  async setCoverage(ticker, dataset, coverage) {
    await connectDB();
    await MarketCoverage.updateOne(
      { ticker: ticker.toUpperCase(), dataset: datasetKey(dataset) },
      setAndUnset({
        from: coverage.from,
        to: coverage.to,
        fetchedAt: coverage.fetchedAt ? new Date(coverage.fetchedAt) : null,
        backfilled: coverage.backfilled ?? null,
      }),
      { upsert: true },
    );
  },

  async getActions(ticker) {
    await connectDB();
    const docs = await MarketAction.find({ ticker: ticker.toUpperCase() })
      .sort({ date: 1 })
      .lean();
    return docs.map((doc) => ({
      ticker: doc.ticker,
      date: doc.date,
      divCash: doc.divCash,
      splitFactor: doc.splitFactor,
    }));
  },

  async upsertActions(ticker, next) {
    if (next.length === 0) return;
    await connectDB();
    await MarketAction.bulkWrite(
      next.map((action) => ({
        updateOne: {
          filter: { ticker: ticker.toUpperCase(), date: action.date },
          update: {
            $set: {
              divCash: action.divCash,
              splitFactor: action.splitFactor,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },
};

const quotes: QuoteStore = {
  async getQuotes(tickers) {
    if (tickers.length === 0) return [];
    await connectDB();
    const docs = await MarketQuote.find({
      ticker: { $in: tickers.map((ticker) => ticker.toUpperCase()) },
    }).lean();
    return docs.map((doc) => ({
      ticker: doc.ticker,
      last: doc.last,
      prevClose: doc.prevClose,
      open: doc.open,
      high: doc.high,
      low: doc.low,
      volume: doc.volume,
      bid: doc.bid,
      ask: doc.ask,
      ts: doc.ts.toISOString(),
      source: doc.source as "iex",
    }));
  },

  async upsertQuotes(next) {
    if (next.length === 0) return;
    await connectDB();
    await MarketQuote.bulkWrite(
      next.map((quote) => ({
        updateOne: {
          filter: { ticker: quote.ticker },
          update: { $set: { ...quote, ts: new Date(quote.ts) } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },
};

const fundamentals: FundamentalStore = {
  async getFundamentals(ticker) {
    await connectDB();
    const docs = await MarketFundamental.find({
      ticker: ticker.toUpperCase(),
    })
      .sort({ periodEnd: -1 })
      .lean();
    return docs.map((doc) => ({
      cik: doc.cik,
      ticker: doc.ticker,
      fiscalYear: doc.fiscalYear,
      fiscalPeriod: doc.fiscalPeriod as "FY",
      periodStart: doc.periodStart ?? undefined,
      periodEnd: doc.periodEnd,
      form: doc.form,
      filed: doc.filed,
      accession: doc.accession,
      facts: doc.facts.map((fact) => ({
        key: fact.key,
        label: fact.label,
        statement: fact.statement as "income",
        value: fact.value,
        unit: fact.unit,
        concept: fact.concept,
      })),
      updatedAt: doc.updatedAt.toISOString(),
    }));
  },

  async upsertFundamentals(periods) {
    if (periods.length === 0) return;
    await connectDB();
    await MarketFundamental.bulkWrite(
      // `updatedAt` is dropped: it arrives as an ISO string and the schema's
      // timestamps option owns that field.
      periods.map(({ updatedAt: _updatedAt, ...period }) => ({
        updateOne: {
          filter: {
            ticker: period.ticker,
            fiscalYear: period.fiscalYear,
            fiscalPeriod: period.fiscalPeriod,
            periodEnd: period.periodEnd,
          },
          update: { $set: { ...period, facts: [...period.facts] } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },

  async getFilings(ticker, limit) {
    await connectDB();
    const docs = await MarketFiling.find({ ticker: ticker.toUpperCase() })
      .sort({ filed: -1 })
      .limit(limit)
      .lean();
    return docs.map((doc) => ({
      cik: doc.cik,
      ticker: doc.ticker ?? undefined,
      accession: doc.accession,
      form: doc.form,
      filed: doc.filed,
      periodOfReport: doc.periodOfReport ?? undefined,
      primaryDocument: doc.primaryDocument ?? undefined,
      url: doc.url,
      description: doc.description ?? undefined,
    }));
  },

  async upsertFilings(next) {
    if (next.length === 0) return;
    await connectDB();
    await MarketFiling.bulkWrite(
      next.map((filing) => ({
        updateOne: {
          filter: { accession: filing.accession },
          update: { $set: filing },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },

  async getNews(ticker, limit) {
    await connectDB();
    const docs = await MarketNews.find({ ticker: ticker.toUpperCase() })
      .sort({ publishedAt: -1 })
      .limit(limit)
      .lean();
    return docs.map((doc) => ({
      id: doc.newsId,
      ticker: doc.ticker ?? undefined,
      headline: doc.headline,
      summary: doc.summary ?? undefined,
      source: doc.source ?? undefined,
      url: doc.url,
      imageUrl: doc.imageUrl ?? undefined,
      publishedAt: doc.publishedAt.toISOString(),
    }));
  },

  async upsertNews(next) {
    if (next.length === 0) return;
    await connectDB();
    await MarketNews.bulkWrite(
      next.map((item) => ({
        updateOne: {
          filter: { newsId: item.id },
          update: setAndUnset({
            newsId: item.id,
            ticker: item.ticker,
            headline: item.headline,
            summary: item.summary,
            source: item.source,
            url: item.url,
            imageUrl: item.imageUrl,
            publishedAt: new Date(item.publishedAt),
          }),
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },
};

export function createMarketStores(tiingoKeyCount = 1): MarketStores {
  return {
    symbols,
    bars,
    quotes,
    fundamentals,
    budget: createMongoBudget(() => new Date(), tiingoKeyCount),
    clock: { now: () => new Date() },
  };
}
