import { type NextRequest, NextResponse } from "next/server";
import { parseLimit, parseTicker } from "@/lib/markets/route-params";
import { getFilings, MarketsNotConfiguredError } from "@/lib/markets/service";
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
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 40, 200);

  try {
    return NextResponse.json({ filings: await getFilings(symbol, limit) });
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Filing fetch failed", error);
    return NextResponse.json({ error: "Filing fetch failed" }, { status: 502 });
  }
}
