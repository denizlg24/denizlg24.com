import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { attempt, isoTime, ticker } from "./shared";
import { runSandbox, sandboxLimits } from "./sandbox";
import type { Bar } from "@/lib/indicators";
import {
  history,
  historyIntervals,
  members,
  quotes,
  series,
  type HistoryInterval,
} from "@/lib/market";
import type { ChartPoint, Quote } from "@/lib/models";
import {
  rangeKeys,
  universeKeys,
  type Range,
} from "@/lib/universes";

const MAX_SYMBOLS = 600;
const MAX_BARS = 200_000;
const CONCURRENCY = 8;
const FETCH_BUDGET_MS = 60_000;
const MAX_MISSING_LISTED = 50;
const BAR_TTL_MS = 300_000;
const INTRADAY_TTL_MS = 60_000;
const QUOTE_TTL_MS = 30_000;
const MAX_CACHED_BARS = 600_000;
const MAX_CACHED_QUOTES = 2000;

type BarRequest =
  | { kind: "range"; range: Range }
  | { kind: "history"; years: number; interval: HistoryInterval };

const significant = (value: number) => Number(value.toPrecision(8));

const toBars = (points: ChartPoint[]): Bar[] =>
  points.map((point) => ({
    time: point.time,
    open: significant(point.open),
    high: significant(point.high),
    low: significant(point.low),
    close: significant(point.close),
    volume: point.volume,
  }));

const barCache = new Map<string, { at: number; bars: Bar[] }>();
let cachedBars = 0;
const quoteCache = new Map<string, { at: number; quote: Quote }>();

function cacheBars(key: string, bars: Bar[]) {
  const existing = barCache.get(key);
  if (existing) {
    cachedBars -= existing.bars.length;
    barCache.delete(key);
  }
  barCache.set(key, { at: Date.now(), bars });
  cachedBars += bars.length;
  for (const [oldest, entry] of barCache) {
    if (cachedBars <= MAX_CACHED_BARS) break;
    cachedBars -= entry.bars.length;
    barCache.delete(oldest);
  }
}

function cacheQuote(quote: Quote) {
  quoteCache.delete(quote.symbol);
  quoteCache.set(quote.symbol, { at: Date.now(), quote });
  for (const oldest of quoteCache.keys()) {
    if (quoteCache.size <= MAX_CACHED_QUOTES) break;
    quoteCache.delete(oldest);
  }
}

const barKey = (symbol: string, request: BarRequest) =>
  request.kind === "range"
    ? `${symbol}|r|${request.range}`
    : `${symbol}|h|${request.years}|${request.interval}`;

const barTtl = (request: BarRequest) =>
  request.kind === "range" && (request.range === "1D" || request.range === "5D")
    ? INTRADAY_TTL_MS
    : BAR_TTL_MS;

async function fetchBars(symbol: string, request: BarRequest) {
  const key = barKey(symbol, request);
  const hit = barCache.get(key);
  if (hit && Date.now() - hit.at < barTtl(request)) return hit.bars;
  const points =
    request.kind === "range"
      ? (await series(symbol, request.range)).points
      : (await history(symbol, request.years, request.interval)).points;
  if (points.length === 0) throw new Error("No data");
  const bars = toBars(points);
  cacheBars(key, bars);
  return bars;
}

async function forEachLimited(
  items: string[],
  until: number,
  work: (item: string) => Promise<void>,
) {
  const skipped: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (Date.now() > until) skipped.push(item);
      else await work(item);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return skipped;
}

const dataRequest = z.object({
  symbols: z
    .array(ticker)
    .max(MAX_SYMBOLS)
    .optional()
    .describe("Explicit tickers (Yahoo style, e.g. AAPL, ASML.AS, ^GSPC)"),
  universe: z
    .enum(universeKeys)
    .optional()
    .describe(
      'A built-in group fetched in full, e.g. "S&P 500" (~500 constituents). Merged with symbols.',
    ),
  range: z
    .enum(rangeKeys)
    .optional()
    .describe(
      "Bar window: 1D (5m bars), 5D (30m), 1M/3M/6M/YTD/1Y (daily), 5Y (weekly). Default 1Y when symbols or a universe is given and history is not.",
    ),
  history: z
    .object({
      years: z.number().min(0.1).max(30),
      interval: z.enum(historyIntervals).default("1d"),
    })
    .optional()
    .describe(
      "Long split/dividend-adjusted history instead of range (total-return bars). Use for multi-year work. Do not combine with range.",
    ),
  quotes: z
    .boolean()
    .default(false)
    .describe("Also fetch live quotes into data.quotes"),
});

type DataRequest = z.infer<typeof dataRequest>;

async function loadData(request: DataRequest) {
  const symbols = [
    ...new Set([
      ...(request.symbols ?? []),
      ...(request.universe
        ? members(request.universe).map((item) => item.symbol)
        : []),
    ]),
  ];
  if (symbols.length > MAX_SYMBOLS)
    throw new Error(
      `${symbols.length} symbols requested; the limit is ${MAX_SYMBOLS}.`,
    );
  if (request.range && request.history)
    throw new Error("Pass either data.range or data.history, not both.");
  const barRequest: BarRequest | null =
    symbols.length === 0
      ? null
      : request.history
        ? { kind: "history", ...request.history }
        : { kind: "range", range: request.range ?? "1Y" };

  const until = Date.now() + FETCH_BUDGET_MS;
  const bars: Record<string, Bar[]> = {};
  const quoteMap: Record<string, Quote> = {};
  const missing = new Set<string>();

  if (barRequest) {
    const skipped = await forEachLimited(symbols, until, async (symbol) => {
      try {
        bars[symbol] = await fetchBars(symbol, barRequest);
      } catch {
        missing.add(symbol);
      }
    });
    for (const symbol of skipped) missing.add(symbol);
    const total = Object.values(bars).reduce((sum, list) => sum + list.length, 0);
    if (total > MAX_BARS)
      throw new Error(
        `${total.toLocaleString("en-US")} bars exceed the ${MAX_BARS.toLocaleString("en-US")} limit. Use fewer symbols, a shorter range, or interval "1wk".`,
      );
  }

  if (request.quotes && symbols.length > 0) {
    const fresh = Date.now() - QUOTE_TTL_MS;
    const stale: string[] = [];
    for (const symbol of symbols) {
      const hit = quoteCache.get(symbol);
      if (hit && hit.at > fresh) quoteMap[symbol] = hit.quote;
      else stale.push(symbol);
    }
    if (stale.length > 0)
      for (const quote of await quotes(stale)) {
        cacheQuote(quote);
        quoteMap[quote.symbol] = quote;
      }
    for (const symbol of symbols)
      if (!quoteMap[symbol] && !(barRequest && bars[symbol])) missing.add(symbol);
  }

  const latest = Math.max(
    0,
    ...Object.values(bars).map((list) => list[list.length - 1].time),
    ...Object.values(quoteMap).map((quote) => quote.time),
  );
  return {
    symbols: symbols.length,
    missing: [...missing],
    payload: {
      bars,
      quotes: quoteMap,
      missing: [...missing],
      asOf: isoTime(latest) ?? new Date().toISOString(),
    },
  };
}

const description = `Run JavaScript in an isolated sandbox over live market data to calculate anything the other tools do not give directly: custom formulas, indicators, screens, breadth or statistics across a universe, backtests, correlations, any algorithm. The server fetches the data you declare first, then runs your code; there is no network, filesystem or require inside the code.

Input: description (one line, shown to the user), data (what to fetch), code (a function BODY: it receives the frozen objects data and ta, and must return a JSON-serialisable value; synchronous; no await).
data: { symbols?: string[], universe?: "S&P 500" | ..., range?: 1D|5D|1M|3M|6M|YTD|1Y|5Y, history?: { years, interval: 1d|1wk|1mo }, quotes?: boolean }. Up to ${MAX_SYMBOLS} symbols and ${MAX_BARS / 1000}k bars in total. Give no data at all for a pure formula. Range 1Y daily bars are enough for 50 and 200-day averages; use history for longer lookbacks (adjusted for splits and dividends).
In code: data.bars[symbol] = [{ time (unix seconds), open, high, low, close, volume|null }] oldest first; data.quotes[symbol] = { symbol, name, currency, price, previous, change, percent, open, high, low, yearHigh, yearLow, volume, cap, time }; data.missing = symbols that failed to load (exclude them from denominators and say how many); data.asOf.
ta (series are arrays of number|null aligned to the input; "bars" means data.bars[symbol]):
- ta.sma(values, n) ema wilder(=rma) stdev(values, n) -> series; ta.highest(values, n) lowest -> series
- ta.rsi(closes, n=14) -> series; ta.macd(closes, fast=12, slow=26, signal=9) -> { line, signal, histogram }; ta.bollinger(closes, n=20, width=2) -> { mid, upper, lower }
- ta.stochastic(bars, n=14, smoothK=3, d=3) -> { k, d }; ta.williams(bars, n) cci(bars, n=20) mfi(bars, n) obv(bars) vwap(bars) psar(bars, step, max) trueRange(bars) atr(bars, n=14) -> series; ta.adx(bars, n=14); ta.ichimoku(bars) -> { conversion, base, spanA, spanB }; ta.heikinAshi(bars) -> bars
- ta.returns(closes) -> simple returns (length-1); ta.drawdowns(closes) -> % from peak; ta.rollingVolatility(bars, window) -> [{ time, value }] annualised; ta.regression(bars, benchmarkBars, step=1) -> { beta, alpha, r2, correlation, ... } | null; ta.rollingBeta(bars, benchmarkBars, window) -> [{ time, beta, correlation }]; ta.correlationMatrix([{ symbol, bars }]) ; ta.backtest(bars, { kind: smaCross|rsi|breakout|momentum|hold, fast, slow, lower, upper, shorts, costBps }) -> { equity, trades, stats }
- stats on plain arrays: ta.sum mean median percentile(values, p0to100) std zscore(values) pctChange(values, n=1) last(values)
Use ta.last(series) for the latest value. Slice or aggregate before returning: a result over ${sandboxLimits.outputChars / 1000} KB is rejected, and the run is limited to ${sandboxLimits.deadlineMs / 1000} s and ${sandboxLimits.memoryBytes / 1024 / 1024} MB.
Charts: return series for createChart's inline form, e.g. { series: [{ name: "% above 50-day SMA", points: [{ x: "2026-03-02", y: 61.2 }] }] } with ISO date x (new Date(bar.time * 1000).toISOString().slice(0, 10)), finite or null y, at most 6 series and 400 points each (downsample first), then call createChart with kind line/area, x: { type: "time" }, those series, source "Yahoo Finance" and asOf.
If the result is { error }, read the message and line number, fix the code, and retry.`;

export function computeTools() {
  return {
    compute: tool({
      description,
      inputSchema: z.object({
        description: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("One line: what is being computed"),
        data: dataRequest.optional(),
        code: z.string().min(1).max(20_000),
      }),
      execute: ({ description, data, code }) =>
        attempt(async () => {
          const started = Date.now();
          const loaded = await loadData(dataRequest.parse(data ?? {}));
          const outcome = await runSandbox(code, JSON.stringify(loaded.payload));
          if (!outcome.ok) return { error: outcome.error };
          return {
            description,
            result: z.json().parse(JSON.parse(outcome.json)),
            asOf: loaded.payload.asOf,
            source: "Yahoo Finance / Moscow Exchange",
            symbols: loaded.symbols,
            missing: loaded.missing.slice(0, MAX_MISSING_LISTED),
            missingCount: loaded.missing.length,
            ms: Date.now() - started,
          };
        }, "The computation failed."),
    }),
  };
}
