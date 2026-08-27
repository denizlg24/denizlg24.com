import { type NextRequest, NextResponse } from "next/server";
import { getFinanceBudgetOverview } from "@/lib/finance/budget";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await getFinanceBudgetOverview());
  } catch (error) {
    console.error("[finance] Budget overview failed", error);
    return NextResponse.json({ error: "Budget unavailable" }, { status: 500 });
  }
}
