import { runnerClaimRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withRunner } from "@/lib/sprints/http";
import { claimRuns } from "@/lib/sprints/runner";

export async function POST(request: NextRequest) {
  return withRunner(request, async () => {
    const input = await readBody(request, runnerClaimRequestSchema);
    return NextResponse.json(await claimRuns(input));
  });
}
