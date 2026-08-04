import { computeRatios } from "@repo/markets/core";
import { type NextRequest, NextResponse } from "next/server";
import { parseTicker } from "@/lib/markets/route-params";
import {
  getFundamentals,
  getProfile,
  getQuotes,
  MarketsNotConfiguredError,
} from "@/lib/markets/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticker } = await params;
  const upper = parseTicker(ticker);
  if (!upper) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  try {
    const { periods, stale } = await getFundamentals(upper);
    // Ratios are derived here rather than stored, so a multiple always reflects
    // the current price against the latest reported fundamentals.
    const [quote, profile] = await Promise.all([
      getQuotes([upper]).catch(() => ({ quotes: [] })),
      getProfile(upper).catch(() => null),
    ]);
    const price = quote.quotes[0]?.last ?? null;

    return NextResponse.json({
      periods,
      ratios: computeRatios({
        ticker: upper,
        periods,
        price,
        // The profile's count is current; the XBRL instant is as old as the
        // last balance sheet, and a buyback between filings moves every
        // per-share figure derived from it.
        sharesOutstanding: profile?.sharesOutstanding ?? null,
      }),
      stale,
    });
  } catch (error) {
    if (error instanceof MarketsNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[markets] Fundamentals fetch failed", error);
    return NextResponse.json(
      { error: "Fundamentals fetch failed" },
      { status: 502 },
    );
  }
}
