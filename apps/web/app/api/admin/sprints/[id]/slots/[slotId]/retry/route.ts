import { type NextRequest, NextResponse } from "next/server";
import { withSprints } from "@/lib/sprints/http";
import { retrySlot } from "@/lib/sprints/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slotId: string }> },
) {
  return withSprints(request, async () => {
    const { id, slotId } = await params;
    return NextResponse.json({ slot: await retrySlot(id, slotId) });
  });
}
