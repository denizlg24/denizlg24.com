/**
 * Rewrites non-USD portfolios into USD.
 *
 * `baseCurrency` was never read by the engine — it labelled the UI and nothing
 * else. So a portfolio created as EUR had EUR entry prices recorded against
 * market data that is always USD, and `marketValue - costBasis` was subtracting
 * one currency from another. The reported gain was the exchange rate.
 *
 * Every recorded amount is converted at the ECB reference rate for its own
 * trade date, which is what the owner would have paid on the day. Quantities are
 * untouched: a share count has no currency. Cash rows carry their amount as
 * `quantity * price`, so scaling `price` alone is correct whichever way round
 * the two were written.
 *
 * Dry run by default; `--execute` writes, and only after a full JSON backup.
 */
import { writeFileSync } from "node:fs";
import { connectDB } from "@/lib/mongodb";
import {
  MarketDailyBar,
  MarketOrder,
  MarketPortfolio,
  MarketPortfolioValuePoint,
  MarketTrade,
} from "@/models/Market";

const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = process.argv.includes("--dry-run");
const CASH_TICKER = "CASH";

if (EXECUTE && DRY_RUN) {
  console.error("--dry-run and --execute are mutually exclusive.");
  process.exit(1);
}

/** ECB reference rates. Weekends and holidays resolve to the prior session. */
async function fetchRate(from: string, date: string): Promise<number> {
  const url = `https://api.frankfurter.dev/v1/${date}?base=${from}&symbols=USD`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Frankfurter ${response.status} for ${from} on ${date}`);
  }
  const body = (await response.json()) as { rates?: Record<string, number> };
  const rate = body.rates?.USD;
  if (typeof rate !== "number" || !(rate > 0)) {
    throw new Error(`No USD rate for ${from} on ${date}`);
  }
  return rate;
}

const dateKey = (value: Date) => value.toISOString().slice(0, 10);

async function main() {
  await connectDB();

  const portfolios = await MarketPortfolio.find({
    baseCurrency: { $ne: "USD" },
  });
  if (portfolios.length === 0) {
    console.log(JSON.stringify({ portfolios: 0, note: "nothing to do" }));
    return;
  }

  const ids = portfolios.map((portfolio) => portfolio._id);
  const trades = await MarketTrade.find({ portfolioId: { $in: ids } }).sort({
    executedAt: 1,
  });
  const orders = await MarketOrder.find({ portfolioId: { $in: ids } });

  // One rate per (currency, date) rather than per row.
  const rates = new Map<string, number>();
  const currencyOf = new Map(
    portfolios.map((portfolio) => [
      portfolio._id.toString(),
      portfolio.baseCurrency,
    ]),
  );
  for (const trade of trades) {
    const currency = currencyOf.get(trade.portfolioId.toString());
    if (!currency) continue;
    const key = `${currency}:${dateKey(trade.executedAt)}`;
    if (!rates.has(key)) {
      rates.set(key, await fetchRate(currency, dateKey(trade.executedAt)));
    }
  }
  for (const portfolio of portfolios) {
    const key = `${portfolio.baseCurrency}:${portfolio.inceptionDate}`;
    if (!rates.has(key)) {
      rates.set(
        key,
        await fetchRate(portfolio.baseCurrency, portfolio.inceptionDate),
      );
    }
  }

  // Evidence, not assumption: an entry price recorded in EUR sits below the USD
  // close for the same session by roughly the rate. A row already in USD sits on
  // it. This is what says whether the conversion is the right thing to do at all.
  const evidence: {
    ticker: string;
    date: string;
    recorded: number;
    barClose: number;
    ratio: number;
    impliedRate: number;
  }[] = [];
  for (const trade of trades) {
    if (trade.ticker === CASH_TICKER) continue;
    const date = dateKey(trade.executedAt);
    // Nearest prior session, not an exact match: today's bar does not exist
    // until after the close, so an exact lookup finds nothing for a trade made
    // today and the comparison silently comes back empty.
    const bar = await MarketDailyBar.findOne({
      ticker: trade.ticker,
      date: { $lte: date },
    }).sort({ date: -1 });
    if (!bar) continue;
    evidence.push({
      ticker: trade.ticker,
      date: bar.date,
      recorded: trade.price,
      barClose: bar.close,
      ratio: trade.price / bar.close,
      impliedRate: bar.close / trade.price,
    });
  }

  const summary = {
    mode: EXECUTE ? "execute" : "dry-run",
    portfolios: portfolios.map((portfolio) => ({
      id: portfolio._id.toString(),
      name: portfolio.name,
      baseCurrency: portfolio.baseCurrency,
      initialCash: portfolio.initialCash,
      rate: rates.get(
        `${portfolio.baseCurrency}:${portfolio.inceptionDate}`,
      ) as number,
    })),
    trades: trades.length,
    orders: orders.length,
    evidence: {
      compared: evidence.length,
      // A tight cluster well under 1 means the prices are not USD.
      ratios: evidence.map((row) => Number(row.ratio.toFixed(4))),
      impliedRates: evidence.map((row) => Number(row.impliedRate.toFixed(4))),
      rows: evidence,
    },
  };

  if (!EXECUTE) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `/tmp/markets-usd-migration-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        portfolios,
        trades,
        orders,
        valuePoints: await MarketPortfolioValuePoint.find({
          portfolioId: { $in: ids },
        }),
      },
      null,
      2,
    ),
  );

  let convertedTrades = 0;
  for (const trade of trades) {
    const currency = currencyOf.get(trade.portfolioId.toString());
    if (!currency) continue;
    const rate = rates.get(
      `${currency}:${dateKey(trade.executedAt)}`,
    ) as number;
    trade.price *= rate;
    trade.fees *= rate;
    await trade.save();
    convertedTrades += 1;
  }

  let convertedOrders = 0;
  for (const order of orders) {
    const currency = currencyOf.get(order.portfolioId.toString());
    if (!currency) continue;
    // Orders are live instructions rather than history, so they convert at the
    // rate for the day they were placed.
    const placed = dateKey(order.createdAt ?? new Date());
    const key = `${currency}:${placed}`;
    if (!rates.has(key)) rates.set(key, await fetchRate(currency, placed));
    const rate = rates.get(key) as number;
    for (const field of [
      "limitPrice",
      "stopPrice",
      "trailAnchor",
      "filledPrice",
    ] as const) {
      if (typeof order[field] === "number") order[field] *= rate;
    }
    // A percentage trail has no currency; only an amount one does.
    if (order.trailBasis === "amount" && typeof order.trailValue === "number") {
      order.trailValue *= rate;
    }
    await order.save();
    convertedOrders += 1;
  }

  for (const portfolio of portfolios) {
    const rate = rates.get(
      `${portfolio.baseCurrency}:${portfolio.inceptionDate}`,
    ) as number;
    portfolio.initialCash *= rate;
    portfolio.baseCurrency = "USD";
    await portfolio.save();
  }

  // Observed intraday points were priced off the mixed units, so they are not
  // convertible — they are wrong by an amount that varies per point. They are
  // re-observed on the next poll.
  const removedPoints = await MarketPortfolioValuePoint.deleteMany({
    portfolioId: { $in: ids },
  });

  console.log(
    JSON.stringify(
      {
        ...summary,
        backupPath,
        convertedTrades,
        convertedOrders,
        convertedPortfolios: portfolios.length,
        removedValuePoints: removedPoints.deletedCount,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("USD migration failed:", error);
    process.exit(1);
  });
