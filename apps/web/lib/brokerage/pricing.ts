import type { Quote } from "@repo/markets/schemas";
import type { BrokerageHolding } from "@repo/schemas";

export type PricingQuote = Pick<
  Quote,
  "ticker" | "last" | "prevClose" | "ts" | "currency"
>;

export interface LivePricing {
  holdings: BrokerageHolding[];
  /** Statement NAV plus this to get the live NAV, so accruals the statement carries survive. */
  navDelta: number;
  /**
   * Change since the previous close, only when every holding is live with a
   * previous close: a partial subtotal is not the account's day P&L.
   */
  dayPnl: number | null;
  pricedAt: string | null;
}

/**
 * Reprices holdings on their resolved Yahoo line. A holding stays on its
 * statement price unless the quote is in the currency the line was resolved
 * for (a mismatch means the relay answered for a different line) and has a
 * last price.
 */
export function priceHoldings(
  holdings: BrokerageHolding[],
  quotes: PricingQuote[],
  statementNav: number,
): LivePricing {
  const byTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));
  let navDelta = 0;
  let dayPnl = 0;
  let dayComplete = holdings.length > 0;
  let pricedAt: string | null = null;

  const repriced: BrokerageHolding[] = [];
  for (const holding of holdings) {
    const quote = holding.quoteTicker
      ? byTicker.get(holding.quoteTicker.toUpperCase())
      : undefined;
    const expected = holding.quoteCurrency ?? holding.currency;
    if (!quote || quote.last == null || quote.currency !== expected) {
      dayComplete = false;
      repriced.push(holding);
      continue;
    }

    const scale = holding.quoteScale ?? 1;
    const price = quote.last / scale;
    const value = holding.quantity * price;
    const valueBase = value * holding.fxRateToBase;
    const unrealizedPnl = value - holding.costBasis;
    navDelta += valueBase - holding.valueBase;
    if (quote.prevClose == null) dayComplete = false;
    else {
      dayPnl +=
        holding.quantity *
        (price - quote.prevClose / scale) *
        holding.fxRateToBase;
    }
    if (!pricedAt || Date.parse(quote.ts) > Date.parse(pricedAt))
      pricedAt = quote.ts;
    repriced.push({
      ...holding,
      markPrice: price,
      value,
      valueBase,
      unrealizedPnl,
      unrealizedPnlBase: unrealizedPnl * holding.fxRateToBase,
      dayChange: quote.prevClose ? quote.last / quote.prevClose - 1 : null,
      pricing: "live",
      quotedAt: quote.ts,
    });
  }

  if (pricedAt === null)
    return { holdings, navDelta: 0, dayPnl: null, pricedAt: null };

  const nav = statementNav + navDelta;
  return {
    holdings: repriced
      .map((holding) => ({
        ...holding,
        percentOfNav: nav ? (holding.valueBase / nav) * 100 : 0,
      }))
      .sort((a, b) => b.valueBase - a.valueBase),
    navDelta,
    dayPnl: dayComplete ? dayPnl : null,
    pricedAt,
  };
}
