import { type NextRequest, NextResponse } from "next/server";
import { withSprints } from "@/lib/sprints/http";
import { getRun } from "@/lib/sprints/service";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  return withSprints(request, async () => {
    const { runId } = await params;
    return NextResponse.json({ run: await getRun(runId) });
  });
}
