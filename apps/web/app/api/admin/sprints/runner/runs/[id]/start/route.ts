import { runnerStartRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withRunner } from "@/lib/sprints/http";
import { startRun } from "@/lib/sprints/runner";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withRunner(request, async () => {
    const { id } = await params;
    const input = await readBody(request, runnerStartRequestSchema);
    return NextResponse.json({ run: await startRun(id, input) });
  });
}
