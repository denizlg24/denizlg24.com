import { type NextRequest, NextResponse } from "next/server";
import { parseTicker } from "@/lib/markets/route-params";
import { computeTechnicals } from "@/lib/markets/technicals";
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

  try {
    const technicals = await computeTechnicals(symbol);
    if (!technicals) {
      return NextResponse.json(
        {
          error: `No cached daily bars for ${symbol}; fetch candles first to backfill`,
        },
        { status: 404 },
      );
    }
    return NextResponse.json(technicals);
  } catch (error) {
    console.error("[markets] Technicals failed", error);
    return NextResponse.json({ error: "Technicals failed" }, { status: 500 });
  }
}
