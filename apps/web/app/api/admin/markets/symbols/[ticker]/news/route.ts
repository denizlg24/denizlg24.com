import { type NextRequest, NextResponse } from "next/server";
import { parseLimit, parseTicker } from "@/lib/markets/route-params";
import { getNews } from "@/lib/markets/service";
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
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"), 20, 100);

  try {
    return NextResponse.json(await getNews(symbol, limit));
  } catch (error) {
    console.error("[markets] News fetch failed", error);
    return NextResponse.json({ error: "News fetch failed" }, { status: 502 });
  }
}
