import { portfolioInputSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { createPortfolio, listPortfolios } from "@/lib/markets/portfolios";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  return NextResponse.json({ portfolios: await listPortfolios() });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = portfolioInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid portfolio" }, { status: 400 });
  }
  return NextResponse.json(
    { portfolio: await createPortfolio(parsed.data) },
    { status: 201 },
  );
}
