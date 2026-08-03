import { portfolioInputSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  deletePortfolio,
  getPortfolio,
  syncPortfolioActions,
  updatePortfolio,
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
  const portfolio = await getPortfolio(id);
  if (!portfolio) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ portfolio });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = portfolioInputSchema
    .partial()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid portfolio" }, { status: 400 });
  }

  const { id } = await params;
  if (!parseObjectId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const portfolio = await updatePortfolio(id, parsed.data);
  if (!portfolio) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // `syncPortfolioActions` derives the generated dividend rows from this flag,
  // so without a resync they and every metric built on them stay stale until
  // the next trade mutation or cron run.
  if (parsed.data.reinvestDividends !== undefined) {
    await syncPortfolioActions(id);
  }
  return NextResponse.json({ portfolio });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!parseObjectId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const deleted = await deletePortfolio(id);
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
