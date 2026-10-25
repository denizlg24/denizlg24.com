import { type NextRequest, NextResponse } from "next/server";
import { getBrokerageOverview } from "@/lib/brokerage/overview";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return NextResponse.json(await getBrokerageOverview());
  } catch (error) {
    console.error("[brokerage] Overview failed", error);
    return NextResponse.json(
      { error: "Failed to load holdings" },
      { status: 500 },
    );
  }
}
