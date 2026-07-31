import { type NextRequest, NextResponse } from "next/server";
import { getPerformance } from "@/lib/markets/portfolios";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const performance = await getPerformance(id);
  if (!performance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(performance);
}
