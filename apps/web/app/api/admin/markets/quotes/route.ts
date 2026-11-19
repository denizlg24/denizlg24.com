import { tickerSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { preferMarketData } from "@/lib/markets/data";
import { getQuotes, MarketsNotConfiguredError } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const tickers = (request.nextUrl.searchParams.get("tickers") ?? "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  if (tickers.length === 0) {
    return NextResponse.json({ quotes: [], stale: false });
  }
  if (tickers.length > 200) {
    return NextResponse.json({ error: "Too many symbols" }, { status: 400 });
  }

  if (tickers.some((ticker) => !tickerSchema.safeParse(ticker).success)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  try {
    const data = await preferMarketData(
      (client) => client.quotes(tickers),
      () => getQuotes(tickers),
    );
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Quote fetch failed", error);
    return NextResponse.json({ error: "Quote fetch failed" }, { status: 502 });
  }
}
