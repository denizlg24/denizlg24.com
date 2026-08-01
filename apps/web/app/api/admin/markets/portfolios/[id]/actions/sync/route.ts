import { type NextRequest, NextResponse } from "next/server";
import { getPortfolio, syncPortfolioActions } from "@/lib/markets/portfolios";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Rebuilds the dividend and split rows from whatever corporate actions are now
 * cached. Reads no provider, so it is safe to run whenever bars have been
 * backfilled behind an existing position.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!(await getPortfolio(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ generated: await syncPortfolioActions(id) });
}
