import { CASH_TICKER } from "@repo/markets/core";
import { tradeInputSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  addTrade,
  listTrades,
  syncPortfolioActions,
} from "@/lib/markets/portfolios";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  return NextResponse.json({ trades: await listTrades(id) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = tradeInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trade" }, { status: 400 });
  }
  // Dividends and splits are regenerated from cached actions, so accepting one
  // by hand would only have it deleted on the next sync. Cash movements have no
  // such generator and can only ever be entered here.
  if (parsed.data.source === "dividend" || parsed.data.source === "split") {
    return NextResponse.json(
      { error: "Generated trades are rebuilt from corporate actions" },
      { status: 400 },
    );
  }
  if (
    (parsed.data.source === "deposit" || parsed.data.source === "withdrawal") &&
    parsed.data.ticker !== CASH_TICKER
  ) {
    return NextResponse.json(
      { error: "Cash movements must be booked against CASH" },
      { status: 400 },
    );
  }

  const { id } = await params;
  const trade = await addTrade(id, parsed.data);
  // A new holding may sit across dividends or splits already in the cache.
  await syncPortfolioActions(id);
  return NextResponse.json({ trade }, { status: 201 });
}
