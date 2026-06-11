import { type NextRequest, NextResponse } from "next/server";
import { getUpcomingCards } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const daysParam = url.searchParams.get("days");
    const parsed = daysParam ? Number.parseInt(daysParam, 10) : 7;
    const days =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 90) : 7;

    const result = await getUpcomingCards(days);
    return NextResponse.json(result, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch upcoming cards" },
      { status: 500 },
    );
  }
}
