import { type NextRequest, NextResponse } from "next/server";
import { withRunner } from "@/lib/sprints/http";
import { heartbeatRun } from "@/lib/sprints/runner";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRunner(request, async () => {
    const { id } = await params;
    return NextResponse.json(await heartbeatRun(id));
  });
}
