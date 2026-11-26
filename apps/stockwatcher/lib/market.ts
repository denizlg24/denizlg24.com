import "server-only";
import constituents from "@/data/sp500.json";
import type {
  ChartPoint,
  CorporateEvent,
  Instrument,
  MarketSeries,
  News,
  Quote,
} from "./models";
import { isMoex, moexQuotes, moexSeries } from "./moex";
import { type Range, ranges, type Universe, universes } from "./universes";

const index = new Map(constituents.map((item) => [item.symbol, item]));
type SourceMeta = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  regularMarketTime?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  marketCap?: number;
  gmtoffset?: number;
};
type SourceBars = {
  timestamp?: number[];
  meta?: SourceMeta;
  events?: {
    dividends?: Record<string, { amount?: number; date?: number }>;
    splits?: Record<
      string,
      {
        date?: number;
        numerator?: number;
        denominator?: number;
        splitRatio?: string;
      }
    >;
  };
  indicators?: {
    quote?: Array<Record<string, Array<number | null>>>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
};
type YahooSearch = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchDisp?: string;
    typeDisp?: string;
  }>;
  news?: Array<{
    title?: string;
    publisher?: string;
    link?: string;
    providerPublishTime?: number;
  }>;
};
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const asNumber = (value: unknown) => (finite(value) ? value : null);

async function yahoo<T>(
  path: string,
  query: Record<string, string>,
  seconds: number,
): Promise<T> {
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const url = new URL(path, `https://${host}`);
      url.search = new URLSearchParams(query).toString();
      const result = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: seconds },
        signal: AbortSignal.timeout(4500),
      });
      if (result.status === 404) throw new Error("Symbol not found");
      if (result.ok) return (await result.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.message === "Symbol not found")
        throw error;
    }
  }
  throw new Error("Yahoo Finance is temporarily unavailable");
}

const CRUMB_TTL_MS = 6 * 3_600_000;
type YahooSession = { cookie: string; crumb: string; at: number };
let yahooSession: YahooSession | null = null;
let yahooSessionPending: Promise<YahooSession> | null = null;

async function openYahooSession(): Promise<YahooSession> {
  const seed = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(4500),
  });
  const cookie = seed.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("Yahoo Finance is temporarily unavailable");
  const response = await fetch(
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(4500),
    },
  );
  const crumb = (await response.text()).trim();
  if (!response.ok || !crumb || crumb.includes("<"))
    throw new Error("Yahoo Finance is temporarily unavailable");
  return { cookie, crumb, at: Date.now() };
}

function ensureYahooSession(refresh: boolean): Promise<YahooSession> {
  if (!refresh && yahooSession && Date.now() - yahooSession.at < CRUMB_TTL_MS)
    return Promise.resolve(yahooSession);
  yahooSessionPending ??= openYahooSession()
    .then((session) => {
      yahooSession = session;
      return session;
    })
    .finally(() => {
      yahooSessionPending = null;
    });
  return yahooSessionPending;
}

/** Like `yahoo`, for endpoints that require a cookie and crumb (v7 options, quoteSummary). */
export async function yahooAuthed<T>(
  path: string,
  query: Record<string, string>,
  seconds: number,
): Promise<T> {
  for (const refresh of [false, true]) {
    const session = await ensureYahooSession(refresh);
    const url = new URL(path, "https://query2.finance.yahoo.com");
    url.search = new URLSearchParams({
      ...query,
      crumb: session.crumb,
    }).toString();
    const result = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: session.cookie },
      next: { revalidate: seconds },
      signal: AbortSignal.timeout(6000),
    });
    if (result.status === 404) throw new Error("Symbol not found");
    if (result.ok) return (await result.json()) as T;
    if (result.status !== 401 && result.status !== 403) break;
  }
  throw new Error("Yahoo Finance is temporarily unavailable");
}

function makeQuote(
  symbol: string,
  bars: SourceBars,
  range: Range,
): Quote | null {
  const meta = bars.meta;
  if (
    !meta?.currency ||
    !finite(meta.regularMarketPrice) ||
    !finite(meta.regularMarketTime)
  )
    return null;
  const closes = bars.indicators?.quote?.[0]?.close ?? [];
  const timestamps = bars.timestamp ?? [];
  const date = new Date(meta.regularMarketTime * 1000);
  const dateKey = date.toISOString().slice(0, 10);
  const lastBar = timestamps.at(-1);
  // Daily Yahoo bars are stamped near the session open. The last dated bar
  // can describe today's still-forming session or the previous completed one.
  const dailyPrevious = closes.findLast(
    (value, i) =>
      finite(value) &&
      timestamps[i] &&
      new Date(timestamps[i] * 1000).toISOString().slice(0, 10) < dateKey,
  );
  const openIndex = timestamps.findIndex(
    (time) => new Date(time * 1000).toISOString().slice(0, 10) === dateKey,
  );
  const previous =
    range === "1D"
      ? asNumber(meta.previousClose ?? dailyPrevious ?? meta.chartPreviousClose)
      : ranges[range][1] === "1d"
        ? asNumber(dailyPrevious)
        : null;
  const open =
    openIndex >= 0 && lastBar
      ? asNumber(bars.indicators?.quote?.[0]?.open?.[openIndex])
      : null;
  const change = previous != null ? meta.regularMarketPrice - previous : null;
  return {
    symbol,
    name: meta.longName ?? meta.shortName ?? index.get(symbol)?.name ?? symbol,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? "",
    currency: meta.currency,
    price: meta.regularMarketPrice,
    previous,
    change,
    percent: change != null && previous ? (change / previous) * 100 : null,
    time: meta.regularMarketTime,
    open,
    high: asNumber(meta.regularMarketDayHigh),
    low: asNumber(meta.regularMarketDayLow),
    yearHigh: asNumber(meta.fiftyTwoWeekHigh),
    yearLow: asNumber(meta.fiftyTwoWeekLow),
    volume: asNumber(meta.regularMarketVolume),
    cap: asNumber(meta.marketCap),
  };
}

const warmupPeriods: Record<Range, string> = {
  "1D": "5d",
  "5D": "1mo",
  "1M": "2y",
  "3M": "2y",
  "6M": "2y",
  YTD: "2y",
  "1Y": "2y",
  "5Y": "10y",
};
const WARMUP_DAYS = 420;

function monthsAgo(months: number) {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return Math.floor(date.getTime() / 1000);
}

/** Index of the first bar the requested range would have shown on its own. */
function visibleFrom(points: ChartPoint[], range: Range, offset: number) {
  if (points.length === 0) return 0;
  const day = (time: number) =>
    new Date((time + offset) * 1000).toISOString().slice(0, 10);
  if (range === "1D" || range === "5D") {
    const sessions = [...new Set(points.map((point) => day(point.time)))];
    const keep = new Set(sessions.slice(range === "1D" ? -1 : -5));
    return Math.max(
      0,
      points.findIndex((point) => keep.has(day(point.time))),
    );
  }
  const cutoff =
    range === "YTD"
      ? Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000
      : monthsAgo({ "1M": 1, "3M": 3, "6M": 6, "1Y": 12, "5Y": 60 }[range]);
  const index = points.findIndex((point) => point.time >= cutoff);
  return index < 0 ? points.length - 1 : index;
}

export async function series(
  symbol: string,
  range: Range,
  since?: string,
  warmup = false,
): Promise<MarketSeries> {
  if (isMoex(symbol)) return moexSeries(symbol, range, since);
  const [period, interval] = ranges[range];
  const start = since ? Date.parse(since) / 1000 : null;
  const end = Math.floor(Date.now() / 1000);
  const fetchStart =
    start != null && warmup ? start - WARMUP_DAYS * 86400 : start;
  const query: Record<string, string> =
    start == null || fetchStart == null
      ? {
          range: warmup ? warmupPeriods[range] : period,
          interval,
          events: "div,splits",
        }
      : {
          period1: String(fetchStart),
          period2: String(end + 86400),
          interval: end - start > 730 * 86400 ? "1wk" : "1d",
          events: "div,splits",
        };
  const result = await yahoo<{ chart?: { result?: SourceBars[] } }>(
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    query,
    range === "1D" && !since ? 45 : 240,
  );
  const bars = result.chart?.result?.[0];
  if (!bars) return { quote: null, points: [] };
  const values = bars.indicators?.quote?.[0];
  const adjusted = bars.indicators?.adjclose?.[0]?.adjclose;
  const points: ChartPoint[] = [];
  bars.timestamp?.forEach((time, i) => {
    const open = values?.open?.[i],
      high = values?.high?.[i],
      low = values?.low?.[i],
      close = values?.close?.[i];
    if (finite(open) && finite(high) && finite(low) && finite(close)) {
      points.push({
        time,
        open,
        high,
        low,
        close,
        adjustedClose: asNumber(adjusted?.[i]) ?? undefined,
        volume: asNumber(values?.volume?.[i]),
      });
    }
  });
  const lead = !warmup
    ? 0
    : start != null
      ? Math.max(
          0,
          points.findIndex((point) => point.time >= start),
        )
      : visibleFrom(points, range, bars.meta?.gmtoffset ?? 0);
  return {
    quote: makeQuote(symbol, bars, since ? "1M" : range),
    points,
    lead,
    source: "Yahoo Finance",
    events: corporateEvents(bars),
  };
}

function corporateEvents(bars: SourceBars): CorporateEvent[] {
  const dividends = Object.values(bars.events?.dividends ?? {}).flatMap(
    (item): CorporateEvent[] =>
      finite(item.amount) && finite(item.date)
        ? [{ kind: "dividend", time: item.date, amount: item.amount }]
        : [],
  );
  const splits = Object.values(bars.events?.splits ?? {}).flatMap(
    (item): CorporateEvent[] =>
      finite(item.date)
        ? [
            {
              kind: "split",
              time: item.date,
              ratio:
                item.splitRatio ??
                `${item.numerator ?? "?"}:${item.denominator ?? "?"}`,
            },
          ]
        : [],
  );
  return [...dividends, ...splits].sort((a, b) => a.time - b.time);
}

function sparkWindow(since?: string) {
  const days = since ? (Date.now() - Date.parse(since)) / 86400000 : 0;
  if (!since || days <= 3) return { range: "5d", interval: "1d" };
  if (days <= 27) return { range: "1mo", interval: "1d" };
  if (days <= 86) return { range: "3mo", interval: "1d" };
  if (days <= 175) return { range: "6mo", interval: "1d" };
  if (days <= 360) return { range: "1y", interval: "1d" };
  if (days <= 720) return { range: "2y", interval: "1d" };
  if (days <= 1815) return { range: "5y", interval: "1wk" };
  return { range: "max", interval: "1wk" };
}

async function spark(symbols: string[], since?: string) {
  const result = await yahoo<{
    spark?: { result?: Array<{ symbol: string; response?: SourceBars[] }> };
  }>(
    "/v7/finance/spark",
    { symbols: symbols.join(","), ...sparkWindow(since) },
    since ? 180 : 65,
  );
  return (result.spark?.result ?? []).flatMap(({ symbol, response }) => {
    const bars = response?.[0];
    const quote = bars && makeQuote(symbol, bars, "1M");
    if (!bars || !quote) return [];
    if (!since) return [quote];
    const start = Date.parse(since) / 1000;
    const close = bars.indicators?.quote?.[0]?.close?.find(
      (close, i) =>
        finite(close) && close > 0 && (bars.timestamp?.[i] ?? 0) >= start,
    );
    return [
      {
        ...quote,
        periodPercent: close ? (quote.price / close - 1) * 100 : null,
      },
    ];
  });
}

export async function quotes(
  symbols: string[],
  since?: string,
): Promise<Quote[]> {
  const unique = [...new Set(symbols)].sort();
  const ordered = unique.filter((symbol) => !isMoex(symbol));
  const moscow = unique.filter(isMoex);
  const moscowBatches = Array.from(
    { length: Math.ceil(moscow.length / 20) },
    (_, i) => moscow.slice(i * 20, (i + 1) * 20),
  );
  const russianQuotes = Promise.allSettled(
    moscowBatches.map((batch) => moexQuotes(batch, since)),
  );
  const batches = Array.from(
    { length: Math.ceil(ordered.length / 20) },
    (_, i) => ordered.slice(i * 20, (i + 1) * 20),
  );
  const found: Quote[] = [];
  for (let i = 0; i < batches.length; i += 5) {
    const results = await Promise.allSettled(
      batches.slice(i, i + 5).map((batch) => spark(batch, since)),
    );
    for (const result of results)
      if (result.status === "fulfilled") found.push(...result.value);
  }
  if (found.length === 0 && ordered.length <= 8) {
    const fallback = await Promise.allSettled(
      ordered.map((symbol) => series(symbol, "1D", since)),
    );
    for (const result of fallback) {
      if (result.status === "fulfilled" && result.value.quote) {
        const quote = result.value.quote;
        const base = result.value.points[0]?.close;
        found.push(
          since
            ? {
                ...quote,
                periodPercent: base ? (quote.price / base - 1) * 100 : null,
              }
            : quote,
        );
      }
    }
  }
  for (const result of await russianQuotes)
    if (result.status === "fulfilled") found.push(...result.value);
  return found;
}

export function members(universe: Universe): Instrument[] {
  if (universe === "S&P 500") return constituents;
  return universes[universe].map(
    (symbol) => index.get(symbol) ?? { symbol, name: symbol },
  );
}

export async function search(
  query: string,
): Promise<{ instruments: Instrument[]; news: News[] }> {
  let output: YahooSearch = {};
  const needle = query.toLowerCase();
  const local = constituents
    .filter(
      (item) =>
        item.symbol.toLowerCase().startsWith(needle) ||
        item.name.toLowerCase().includes(needle),
    )
    .slice(0, 8);
  try {
    output = await yahoo<YahooSearch>(
      "/v1/finance/search",
      {
        q: query,
        quotesCount: "10",
        newsCount: "12",
        enableFuzzyQuery: "true",
      },
      300,
    );
  } catch (error) {
    if (local.length === 0) throw error;
  }
  const remote = (output.quotes ?? []).flatMap((item): Instrument[] =>
    item.symbol
      ? [
          {
            symbol: item.symbol,
            name: item.longname ?? item.shortname ?? item.symbol,
            exchange: item.exchDisp,
            type: item.typeDisp,
            sector: index.get(item.symbol)?.sector,
          },
        ]
      : [],
  );
  return {
    instruments: [
      ...new Map(
        [...local, ...remote].map((item) => [item.symbol, item]),
      ).values(),
    ],
    news: (output.news ?? []).flatMap((item): News[] =>
      item.title && item.link?.startsWith("https://")
        ? [
            {
              title: item.title,
              url: item.link,
              publisher: item.publisher ?? "Yahoo Finance",
              time: item.providerPublishTime ?? 0,
            },
          ]
        : [],
    ),
  };
}

export async function comparison(
  symbols: string[],
  range: Range,
  since?: string,
) {
  const responses = await Promise.allSettled(
    symbols.map((symbol) => series(symbol, range, since)),
  );
  const available = responses.flatMap((item, i) =>
    item.status === "fulfilled" && item.value.points.length > 1
      ? [{ symbol: symbols[i], points: item.value.points }]
      : [],
  );
  const adjusted =
    available.length > 0 &&
    available.every(({ points }) =>
      points.every((point) => point.adjustedClose != null),
    );
  const historical = available.map(({ symbol, points }) => ({
    symbol,
    byDay: new Map(
      points.map((item) => [
        new Date(item.time * 1000).toISOString().slice(0, 10),
        adjusted ? item.adjustedClose! : item.close,
      ]),
    ),
  }));
  const reported = available.map((item) => item.symbol);
  const dates =
    historical.length < 2
      ? []
      : [...historical[0].byDay.keys()].filter((date) =>
          historical.every((item) => (item.byDay.get(date) ?? 0) > 0),
        );
  const first = dates[0];
  const points =
    dates.length > 1
      ? dates.map((date) => ({
          date,
          ...Object.fromEntries(
            historical.map((item) => [
              item.symbol,
              (item.byDay.get(date)! / item.byDay.get(first)! - 1) * 100,
            ]),
          ),
        }))
      : [];
  return {
    points,
    symbols: reported,
    missing: symbols.filter((symbol) => !reported.includes(symbol)),
    adjusted,
    source: symbols.every(isMoex)
      ? "Moscow Exchange"
      : symbols.some(isMoex)
        ? "Yahoo Finance · Moscow Exchange"
        : "Yahoo Finance",
  };
}

export const historyIntervals = ["1d", "1wk", "1mo"] as const;
export type HistoryInterval = (typeof historyIntervals)[number];
export type History = {
  symbol: string;
  name: string | null;
  currency: string | null;
  points: ChartPoint[];
};

/**
 * Long daily, weekly or monthly history for analytics. Closes are adjusted
 * for splits and dividends when Yahoo provides an adjusted series, so
 * returns are total returns.
 */
export async function history(
  symbol: string,
  years: number,
  interval: HistoryInterval,
): Promise<History> {
  const end = Math.floor(Date.now() / 1000);
  const result = await yahoo<{ chart?: { result?: SourceBars[] } }>(
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    {
      period1: String(end - Math.round(years * 365.25 * 86400)),
      period2: String(end + 86400),
      interval,
      events: "div,splits",
    },
    interval === "1d" ? 900 : 3600,
  );
  const bars = result.chart?.result?.[0];
  if (!bars) return { symbol, name: null, currency: null, points: [] };
  const values = bars.indicators?.quote?.[0];
  const adjusted = bars.indicators?.adjclose?.[0]?.adjclose;
  const points: ChartPoint[] = [];
  bars.timestamp?.forEach((time, i) => {
    const open = values?.open?.[i],
      high = values?.high?.[i],
      low = values?.low?.[i],
      close = values?.close?.[i];
    if (finite(open) && finite(high) && finite(low) && finite(close)) {
      const adj = adjusted?.[i];
      const adjustment = finite(adj) ? adj / close : 1;
      points.push({
        time,
        open: open * adjustment,
        high: high * adjustment,
        low: low * adjustment,
        close: close * adjustment,
        volume: asNumber(values?.volume?.[i]),
      });
    }
  });
  return {
    symbol,
    name: bars.meta?.longName ?? bars.meta?.shortName ?? null,
    currency: bars.meta?.currency ?? null,
    points,
  };
}

export type WireItem = News & { symbols: string[]; id: string };

/** Recent headlines for each symbol, merged and de-duplicated by story. */
export async function newsWire(symbols: string[]): Promise<WireItem[]> {
  const results = await Promise.allSettled(
    symbols.map((symbol) =>
      yahoo<
        YahooSearch & {
          news?: Array<{ uuid?: string; relatedTickers?: string[] }>;
        }
      >(
        "/v1/finance/search",
        { q: symbol, quotesCount: "0", newsCount: "8" },
        300,
      ).then((output) => ({ symbol, output })),
    ),
  );
  const stories = new Map<string, WireItem>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { symbol, output } = result.value;
    for (const item of output.news ?? []) {
      if (!item.title || !item.link?.startsWith("https://")) continue;
      const id =
        ("uuid" in item && typeof item.uuid === "string" && item.uuid) ||
        item.link;
      const related =
        "relatedTickers" in item && Array.isArray(item.relatedTickers)
          ? item.relatedTickers.filter(
              (ticker): ticker is string => typeof ticker === "string",
            )
          : [];
      const prior = stories.get(id);
      stories.set(id, {
        id,
        title: item.title,
        url: item.link,
        publisher: item.publisher ?? "Yahoo Finance",
        time: item.providerPublishTime ?? 0,
        symbols: [
          ...new Set([
            ...(prior?.symbols ?? []),
            symbol,
            ...related.filter((ticker) => symbols.includes(ticker)),
          ]),
        ],
      });
    }
  }
  return [...stories.values()].sort((a, b) => b.time - a.time);
}

export async function trending(region = "US") {
  const result = await yahoo<{
    finance?: { result?: Array<{ quotes?: Array<{ symbol?: string }> }> };
  }>(`/v1/finance/trending/${region}`, { count: "20" }, 300);
  return (result.finance?.result?.[0]?.quotes ?? []).flatMap((item) =>
    item.symbol ? [item.symbol] : [],
  );
}
