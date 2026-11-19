import { MarketDataClient, MarketDataError } from "@repo/markets/client";

export function marketData(): MarketDataClient | null {
  const token =
    process.env.MARKETS_DATA_TOKEN || process.env.MARKETS_RELAY_TOKEN_SECRET;
  const base =
    process.env.MARKETS_DATA_URL || process.env.NEXT_PUBLIC_MARKETS_RELAY_URL;
  if (!token || !base) return null;
  const url = base.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
  return new MarketDataClient({ url, token, timeoutMs: 25_000 });
}

export async function preferMarketData<T, U>(
  request: (client: MarketDataClient) => Promise<T>,
  fallback: () => Promise<U>,
): Promise<T | U> {
  const client = marketData();
  if (client) {
    try {
      return await request(client);
    } catch (error) {
      if (error instanceof MarketDataError && error.status === 422) throw error;
    }
  }
  return fallback();
}

export function marketDataErrorResponse(error: unknown) {
  if (
    error instanceof MarketDataError &&
    (error.status === 404 || error.status === 422)
  ) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "Markets data unavailable" }, { status: 503 });
}
