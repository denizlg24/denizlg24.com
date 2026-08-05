import { after, type NextRequest, NextResponse } from "next/server";
import { getPerformance, recordValuePoint } from "@/lib/markets/portfolios";
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
  const performance = await getPerformance(id, { intraday: true });
  if (!performance) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // The page polls this while it is open, so every poll is a live observation of
  // the book and the cheapest intraday curve available. It is written after the
  // response rather than before it: the caller asked for performance, not for a
  // point of history it will only see on its next poll.
  after(async () => {
    await recordValuePoint(id, performance).catch((error) => {
      console.error("[markets] Value point write failed", error);
    });
  });
  return NextResponse.json(performance);
}
