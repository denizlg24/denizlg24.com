import { resolutionSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { parseTicker } from "@/lib/markets/route-params";
import { getCandles, MarketsNotConfiguredError } from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const series = await getCandles({
      ticker: symbol,
      resolution: resolution.data,
      from,
      to,
      adjusted: search.get("adjusted") !== "false",
    });
    return NextResponse.json(series);
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Candle fetch failed", error);
    return NextResponse.json({ error: "Candle fetch failed" }, { status: 502 });
  }
}
