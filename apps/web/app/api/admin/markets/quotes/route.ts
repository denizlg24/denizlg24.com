import { type NextRequest, NextResponse } from "next/server";
import { getQuotes, MarketsNotConfiguredError } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Batched deliberately: Tiingo charges one request whether it is asked for one
 * symbol or fifty, so the client sends the whole visible set at once.
 */
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

  try {
    return NextResponse.json(await getQuotes(tickers));
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Quote fetch failed", error);
    return NextResponse.json({ error: "Quote fetch failed" }, { status: 502 });
  }
}
