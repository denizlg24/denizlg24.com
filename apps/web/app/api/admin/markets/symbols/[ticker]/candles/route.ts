import { MarketDataError } from "@repo/markets/client";
import { isoDateSchema, resolutionSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { marketDataErrorResponse, preferMarketData } from "@/lib/markets/data";
import { parseTicker } from "@/lib/markets/route-params";
import { getCandles, MarketsNotConfiguredError } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticker } = await params;
  const symbol = parseTicker(ticker);
  if (!symbol) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const search = request.nextUrl.searchParams;
  const resolution = resolutionSchema.safeParse(
    search.get("resolution") ?? "1day",
  );
  if (!resolution.success) {
    return NextResponse.json({ error: "Invalid resolution" }, { status: 400 });
  }

  const from = search.get("from") ?? undefined;
  const to = search.get("to") ?? undefined;
  if (
    (from !== undefined && !isoDateSchema.safeParse(from).success) ||
    (to !== undefined && !isoDateSchema.safeParse(to).success) ||
    (from && to && from > to)
  ) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const query = {
      ticker: symbol,
      resolution: resolution.data,
      from,
      to,
      adjusted: search.get("adjusted") !== "false",
    };
    const series = await preferMarketData(
      (client) => client.history(query),
      () => getCandles(query),
    );
    return NextResponse.json(series);
  } catch (error) {
    if (error instanceof MarketDataError) return marketDataErrorResponse(error);
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Candle fetch failed", error);
    return NextResponse.json({ error: "Candle fetch failed" }, { status: 502 });
  }
}
