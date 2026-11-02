import { componentActionRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { pressComponentAction } from "@/lib/workspace/components";
import { readBody, withWorkspace } from "@/lib/workspace/http";

/** Runs a component button's stored actions, hosted by the block that places it. */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async (_service, caller) => {
    const input = await readBody(request, componentActionRequestSchema);
    return NextResponse.json({
      results: await pressComponentAction(input, caller),
    });
  });
}
