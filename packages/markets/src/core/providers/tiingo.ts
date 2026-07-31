import { z } from "zod";
import type {
  Bar,
  CandleQuery,
  CorporateAction,
  DailyBar,
  MarketSymbol,
  Quote,
  Resolution,
} from "../../schemas";
import {
  BudgetExhaustedError,
  type BudgetPort,
  type MarketDataProvider,
  ProviderError,
} from "../ports";

const BASE_URL = "https://api.tiingo.com";

const dailyRowSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nullable().default(0),
  adjOpen: z.number(),
  adjHigh: z.number(),
  adjLow: z.number(),
  adjClose: z.number(),
  adjVolume: z.number().nullable().default(0),
  divCash: z.number().default(0),
  splitFactor: z.number().default(1),
});

const intradayRowSchema = z.object({
  date: z.string(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nullable().default(0),
});

const metadataSchema = z.object({
  ticker: z.string(),
  name: z.string().nullable().default(""),
  exchangeCode: z.string().nullable().default(null),
  startDate: z.string().nullable().default(null),
  endDate: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
});

const iexQuoteSchema = z.object({
  ticker: z.string(),
  timestamp: z.string().nullable().default(null),
  last: z.number().nullable().default(null),
  tngoLast: z.number().nullable().default(null),
  prevClose: z.number().nullable().default(null),
  open: z.number().nullable().default(null),
  high: z.number().nullable().default(null),
  low: z.number().nullable().default(null),
  volume: z.number().nullable().default(null),
  bidPrice: z.number().nullable().default(null),
  askPrice: z.number().nullable().default(null),
});

/** Tiingo's `resampleFreq` spelling for the resolutions it serves intraday. */
const RESAMPLE_FREQ: Partial<Record<Resolution, string>> = {
  "1min": "1min",
  "5min": "5min",
  "15min": "15min",
  "30min": "30min",
  "1hour": "1hour",
};

export interface TiingoOptions {
  apiKey: string;
  budget: BudgetPort;
  fetchImpl?: typeof fetch;
}

export class TiingoProvider implements MarketDataProvider {
  readonly name = "tiingo" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TiingoOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Every call funnels through here so nothing can reach Tiingo without first
   * reserving budget. A reservation that fails to leave the process is handed
   * back, otherwise a network blip would permanently burn the day's quota.
   */
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    params: Record<string, string | undefined> = {},
  ): Promise<T> {
    const allowed = await this.options.budget.consume("tiingo", 1);
    if (!allowed) throw new BudgetExhaustedError("tiingo");

    const url = new URL(path, BASE_URL);
    url.searchParams.set("format", "json");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          // The token goes in a header, not the query string, so it stays out
          // of proxy and CDN logs.
          Authorization: `Token ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      await this.options.budget.release("tiingo", 1);
      throw new ProviderError("tiingo", `Request failed: ${String(error)}`);
    }

    if (response.status === 429) {
      throw new ProviderError("tiingo", "Rate limited by Tiingo", 429);
    }
    if (!response.ok) {
      throw new ProviderError(
        "tiingo",
        `${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(
        "tiingo",
        `Unexpected response shape: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  async getSymbol(ticker: string): Promise<MarketSymbol | null> {
    const meta = await this.request(
      `/tiingo/daily/${encodeURIComponent(ticker.toLowerCase())}`,
      metadataSchema,
    );
    return {
      ticker: meta.ticker.toUpperCase(),
      name: meta.name || meta.ticker.toUpperCase(),
      exchange: meta.exchangeCode ?? undefined,
      assetType: "stock",
      currency: "USD",
      startDate: meta.startDate?.slice(0, 10),
      endDate: meta.endDate?.slice(0, 10),
      active: true,
      updatedAt: new Date().toISOString(),
    };
  }

  async getDailyBars(
    ticker: string,
    from?: string,
    to?: string,
  ): Promise<DailyBar[]> {
    const rows = await this.request(
      `/tiingo/daily/${encodeURIComponent(ticker.toLowerCase())}/prices`,
      z.array(dailyRowSchema),
      { startDate: from, endDate: to },
    );
    return rows.map((row) => ({
      date: row.date.slice(0, 10),
      ts: new Date(row.date).toISOString(),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? 0,
      adjOpen: row.adjOpen,
      adjHigh: row.adjHigh,
      adjLow: row.adjLow,
      adjClose: row.adjClose,
      adjVolume: row.adjVolume ?? 0,
      divCash: row.divCash,
      splitFactor: row.splitFactor,
    }));
  }

  async getIntradayBars(query: CandleQuery): Promise<Bar[]> {
    const resampleFreq = RESAMPLE_FREQ[query.resolution];
    if (!resampleFreq) {
      throw new ProviderError(
        "tiingo",
        `${query.resolution} is not an intraday resolution`,
      );
    }
    const rows = await this.request(
      `/iex/${encodeURIComponent(query.ticker.toLowerCase())}/prices`,
      z.array(intradayRowSchema),
      { startDate: query.from, endDate: query.to, resampleFreq },
    );
    return rows.map((row) => ({
      ts: new Date(row.date).toISOString(),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume ?? 0,
    }));
  }

  /**
   * One request covers every ticker passed, which is the only reason a live
   * dashboard fits inside 50 requests an hour. Never call this per symbol.
   */
  async getQuotes(tickers: string[]): Promise<Quote[]> {
    if (tickers.length === 0) return [];
    const rows = await this.request("/iex", z.array(iexQuoteSchema), {
      tickers: tickers.join(","),
    });
    return rows.map((row) => ({
      ticker: row.ticker.toUpperCase(),
      // tngoLast is Tiingo's cleaned print; `last` can be stale off-hours.
      last: row.tngoLast ?? row.last,
      prevClose: row.prevClose,
      open: row.open,
      high: row.high,
      low: row.low,
      volume: row.volume,
      bid: row.bidPrice,
      ask: row.askPrice,
      ts: row.timestamp
        ? new Date(row.timestamp).toISOString()
        : new Date().toISOString(),
      source: "iex" as const,
    }));
  }

  /**
   * Dividends and splits ride along on the daily rows, so this reuses the same
   * request rather than spending a second one.
   */
  async getActions(ticker: string, from?: string): Promise<CorporateAction[]> {
    const bars = await this.getDailyBars(ticker, from);
    return bars
      .filter((bar) => bar.divCash !== 0 || bar.splitFactor !== 1)
      .map((bar) => ({
        ticker: ticker.toUpperCase(),
        date: bar.date,
        divCash: bar.divCash,
        splitFactor: bar.splitFactor,
      }));
  }
}
