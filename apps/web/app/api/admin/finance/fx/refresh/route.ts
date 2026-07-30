import { type NextRequest, NextResponse } from "next/server";
import { refreshFinanceFxRates } from "@/lib/finance/fx";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await refreshFinanceFxRates());
  } catch (error) {
    console.error("[finance] FX refresh failed", error);
    return NextResponse.json(
      { error: "Failed to refresh exchange rates" },
      { status: 502 },
    );
  }
}
