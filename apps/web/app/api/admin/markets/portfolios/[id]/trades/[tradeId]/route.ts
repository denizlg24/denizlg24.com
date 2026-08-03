import { type NextRequest, NextResponse } from "next/server";
import { deleteTrade, syncPortfolioActions } from "@/lib/markets/portfolios";
import { parseObjectId } from "@/lib/markets/route-params";
import { requireAdmin } from "@/lib/require-admin";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, tradeId } = await params;
  if (!parseObjectId(id) || !parseObjectId(tradeId)) {
    return NextResponse.json(
      { error: "No manual trade with that id" },
      { status: 404 },
    );
  }
  const deleted = await deleteTrade(id, tradeId);
  if (!deleted) {
    return NextResponse.json(
      { error: "No manual trade with that id" },
      { status: 404 },
    );
  }
  await syncPortfolioActions(id);
  return NextResponse.json({ success: true });
}
