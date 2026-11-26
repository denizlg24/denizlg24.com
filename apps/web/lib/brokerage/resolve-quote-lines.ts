import type { BrokeragePosition } from "@repo/schemas";
import { getQuotes } from "@/lib/markets/service";
import {
  alternativeFor,
  chooseLine,
  type Probe,
  probeQuote,
  type QuoteLine,
  yahooLine,
} from "./quote-line";

/** Two positions can share a default ticker in different currencies. */
const keyOf = (line: QuoteLine) => `${line.ticker}|${line.currency}`;

async function probeAll(lines: QuoteLine[]) {
  const probes = new Map<string, Probe>();
  const tickers = [...new Set(lines.map((line) => line.ticker))];
  if (tickers.length === 0) return probes;
  const now = Date.now();
  try {
    const { quotes, stale } = await getQuotes(tickers);
    const byTicker = new Map(quotes.map((quote) => [quote.ticker, quote]));
    for (const line of lines)
      probes.set(
        keyOf(line),
        probeQuote(byTicker.get(line.ticker), line, now, !stale),
      );
  } catch {
    for (const line of lines) probes.set(keyOf(line), "unknown");
  }
  return probes;
}

/**
 * Stamps each position with the Yahoo line to price it on. Never throws: a
 * position that cannot be mapped keeps its statement price, and an inconclusive
 * probe (relay down) keeps the default mapping.
 */
export async function attachQuoteLines(
  positions: BrokeragePosition[],
): Promise<BrokeragePosition[]> {
  const defaults = positions.map((position) =>
    yahooLine(position.symbol, position.listingExchange, position.currency),
  );
  const primary = await probeAll(
    defaults.filter((line): line is QuoteLine => line !== null),
  );
  const alternatives = new Map<string, QuoteLine>();
  for (const line of defaults) {
    if (!line) continue;
    const alternative = alternativeFor(line, primary.get(keyOf(line)));
    if (alternative) alternatives.set(keyOf(line), alternative);
  }
  const secondary = await probeAll([...alternatives.values()]);

  return positions.map((position, index) => {
    const line = defaults[index];
    if (!line) return position;
    const alternative = alternatives.get(keyOf(line));
    const chosen = chooseLine(
      line,
      alternative,
      alternative && secondary.get(keyOf(alternative)),
    );
    return {
      ...position,
      quoteTicker: chosen.ticker,
      quoteCurrency: chosen.currency,
      quoteScale: chosen.scale,
    };
  });
}
