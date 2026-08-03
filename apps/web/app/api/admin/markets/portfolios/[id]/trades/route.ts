import { CASH_TICKER } from "@repo/markets/core";
import { tradeInputSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  addTrade,
  getPortfolio,
  listTrades,
  OWNER_ENTERED_SOURCES,
  syncPortfolioActions,
} from "@/lib/markets/portfolios";
import { parseObjectId } from "@/lib/markets/route-params";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!parseObjectId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
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
  if (!OWNER_ENTERED_SOURCES.includes(parsed.data.source)) {
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
  // Confirmed before the write, so a bad id cannot leave an orphan trade row
  // pointing at a portfolio that does not exist.
  if (!parseObjectId(id) || !(await getPortfolio(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const trade = await addTrade(id, parsed.data);
  // A new holding may sit across dividends or splits already in the cache.
  await syncPortfolioActions(id);
  return NextResponse.json({ trade }, { status: 201 });
}
