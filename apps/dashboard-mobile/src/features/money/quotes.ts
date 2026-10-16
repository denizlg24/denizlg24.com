import type { DashboardWatchlistQuote } from "@repo/schemas";
import type { Quote } from "@repo/schemas/markets";

/** Percent move since the previous close; null without both prices. */
export function changePercent(quote: Quote): number | null {
  if (
    quote.last === null ||
    quote.prevClose === null ||
    quote.prevClose === 0
  ) {
    return null;
  }
  return ((quote.last - quote.prevClose) / quote.prevClose) * 100;
}

/** What the watchlist widget draws, in the watchlist's own order. */
export function widgetQuotes(
  tickers: string[],
  quotes: Quote[],
): DashboardWatchlistQuote[] {
  const byTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));
  return tickers.flatMap((ticker) => {
    const quote = byTicker.get(ticker);
    return quote
      ? [
          {
            symbol: ticker,
            price: quote.last,
            changePercent: changePercent(quote),
            currency: "USD",
          },
        ]
      : [];
  });
}

/** `+1.24%` / `−0.50%`, with a real minus sign. */
export function signedPercent(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "—";
  const fixed = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${fixed}%` : value < 0 ? `−${fixed}%` : `${fixed}%`;
}

/** USD amounts in the markets book, which is USD-only by design. */
export function usd(value: number, digits = 2) {
  const fixed = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${value < 0 ? "−" : ""}$${fixed}`;
}
