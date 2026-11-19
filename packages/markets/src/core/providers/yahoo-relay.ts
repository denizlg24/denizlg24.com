import { type MarketDataClient, MarketDataError } from "../../client";
import type {
  Bar,
  CandleQuery,
  CorporateAction,
  DailyBar,
  MarketSymbol,
  Quote,
} from "../../schemas";
import { type MarketDataProvider, ProviderUnavailableError } from "../ports";

/**
 * Yahoo Finance through the markets relay. Unmetered, so nothing here touches
 * the budget ledger; what can go wrong is the relay or Yahoo being down, which
 * surfaces as `ProviderUnavailableError` so every cache serves stale instead.
 * A 404 or 422 is an answer about the request, not an outage, and is rethrown.
 */
export class YahooRelayProvider implements MarketDataProvider {
  readonly name = "yahoo" as const;

  constructor(private readonly client: MarketDataClient) {}

  async getSymbol(ticker: string): Promise<MarketSymbol | null> {
    try {
      return (await this.call(() => this.client.instrument(ticker))).symbol;
    } catch (error) {
      if (error instanceof MarketDataError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * The cache stores raw and adjusted prices on one row with the day's
   * dividend and split, so a range is three relay reads merged by date.
   */
  async getDailyBars(
    ticker: string,
    from?: string,
    to?: string,
  ): Promise<DailyBar[]> {
    const query = { ticker, resolution: "1day" as const, from, to };
    const [raw, adjusted, actions] = await Promise.all([
      this.history({ ...query, adjusted: false }),
      this.history({ ...query, adjusted: true }),
      this.call(() => this.client.actions(ticker)),
    ]);
    if (actions.stale) {
      throw new ProviderUnavailableError("yahoo", "Relay served stale actions");
    }
    return mergeDailyBars(raw, adjusted, actions.actions);
  }

  async getIntradayBars(query: CandleQuery): Promise<Bar[]> {
    return this.history(query);
  }

  /**
   * The relay answers 200 with its own cached copy, flagged stale, when Yahoo
   * fails. Storing that as a fetch would advance coverage over data nobody
   * refreshed, so it reads as an outage and the cache serves stale instead.
   */
  private async history(query: CandleQuery): Promise<Bar[]> {
    const series = await this.call(() => this.client.history(query));
    if (series.freshness.stale) {
      throw new ProviderUnavailableError("yahoo", "Relay served stale history");
    }
    return series.bars;
  }

  async getQuotes(tickers: string[]): Promise<Quote[]> {
    return (await this.call(() => this.client.quotes(tickers))).quotes;
  }

  async getActions(ticker: string, from?: string): Promise<CorporateAction[]> {
    const { actions } = await this.call(() => this.client.actions(ticker));
    return from ? actions.filter((action) => action.date >= from) : actions;
  }

  private async call<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (
        error instanceof MarketDataError &&
        error.status < 500 &&
        error.status !== 429
      ) {
        throw error;
      }
      throw new ProviderUnavailableError(
        "yahoo",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function mergeDailyBars(
  raw: Bar[],
  adjusted: Bar[],
  actions: CorporateAction[],
): DailyBar[] {
  const adjustedByDate = new Map(
    adjusted.map((bar) => [bar.ts.slice(0, 10), bar]),
  );
  const actionByDate = new Map(actions.map((action) => [action.date, action]));
  return raw.map((bar) => {
    const date = bar.ts.slice(0, 10);
    const adj = adjustedByDate.get(date) ?? bar;
    const action = actionByDate.get(date);
    return {
      ...bar,
      date,
      adjOpen: adj.open,
      adjHigh: adj.high,
      adjLow: adj.low,
      adjClose: adj.close,
      adjVolume: adj.volume,
      divCash: action?.divCash ?? 0,
      splitFactor: action?.splitFactor ?? 1,
    };
  });
}
