import type { z } from "zod";
import {
  type CandleQuery,
  candleSeriesSchema,
  type FinancialFrequency,
  type FinancialStatement,
  macroCatalogSchema,
  macroHistorySchema,
  marketActionsSchema,
  marketFinancialsSchema,
  marketInstrumentSchema,
  marketNewsSchema,
  marketSearchSchema,
  marketSnapshotsSchema,
} from "./schemas";

export class MarketDataError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export interface MarketDataClientOptions {
  url: string;
  /** Private server credential. */
  token: string;
  timeoutMs?: number;
  fetch?: (url: URL, init: RequestInit) => Promise<Response>;
}

type DateRange = { from?: string; to?: string };

export class MarketDataClient {
  private readonly origin: string;

  constructor(private readonly options: MarketDataClientOptions) {
    const url = new URL(options.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("Markets data URL must use HTTP or HTTPS");
    }
    this.origin = url.origin;
  }

  search(query: string, limit = 20) {
    return this.get(marketSearchSchema, "/v1/search", { q: query, limit });
  }

  quotes(tickers: string[]) {
    if (tickers.length === 0) {
      return Promise.resolve({ quotes: [], missing: [], stale: false });
    }
    return this.get(marketSnapshotsSchema, "/v1/quotes", {
      tickers: tickers.join(","),
    });
  }

  history({ ticker, ...query }: CandleQuery) {
    return this.get(
      candleSeriesSchema,
      `/v1/history/${encodeURIComponent(ticker)}`,
      query,
    );
  }

  instrument(ticker: string) {
    return this.get(
      marketInstrumentSchema,
      `/v1/instruments/${encodeURIComponent(ticker)}`,
    );
  }

  actions(ticker: string) {
    return this.get(
      marketActionsSchema,
      `/v1/actions/${encodeURIComponent(ticker)}`,
    );
  }

  news(ticker: string, limit = 15) {
    return this.get(
      marketNewsSchema,
      `/v1/news/${encodeURIComponent(ticker)}`,
      { limit },
    );
  }

  financials(
    ticker: string,
    statement: FinancialStatement = "income",
    frequency: FinancialFrequency = "yearly",
  ) {
    return this.get(
      marketFinancialsSchema,
      `/v1/financials/${encodeURIComponent(ticker)}`,
      { statement, frequency },
    );
  }

  macroCatalog() {
    return this.get(macroCatalogSchema, "/v1/macro");
  }

  macroHistory(series: string, range: DateRange = {}) {
    return this.get(
      macroHistorySchema,
      `/v1/macro/${encodeURIComponent(series)}`,
      range,
    );
  }

  private async get<T>(
    schema: z.ZodType<T>,
    path: string,
    params: Record<string, string | number | boolean | undefined> = {},
  ): Promise<T> {
    const url = new URL(path, this.origin);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await (this.options.fetch ?? fetch)(url, {
      headers: { Authorization: `Bearer ${this.options.token}` },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const detail =
        typeof error?.detail === "string"
          ? error.detail
          : "Markets request failed";
      throw new MarketDataError(response.status, detail);
    }
    return schema.parse(await response.json());
  }
}
