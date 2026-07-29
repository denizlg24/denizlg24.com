import { type NextRequest, NextResponse } from "next/server";
import { getFinanceDashboard } from "@/lib/finance/dashboard";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await getFinanceDashboard());
  } catch (error) {
    console.error("[finance] Dashboard load failed", error);
    return NextResponse.json(
      { error: "Failed to load finance data" },
      { status: 500 },
    );
  }
}
