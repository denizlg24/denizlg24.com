import { buttonRunRequestSchema } from "@repo/schemas";
import { after, type NextRequest, NextResponse } from "next/server";
import { drainAgentTaskRun } from "@/lib/agent-tasks/execution";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { runSectionNow } from "@/lib/workspace/sections";

export const maxDuration = 300;

/** Runs an agent section now, after the response, instead of on its schedule. */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async () => {
    const { pageId, blockId } = await readBody(request, buttonRunRequestSchema);
    const { state, runId } = await runSectionNow(pageId, blockId);
    after(async () => {
      try {
        await drainAgentTaskRun(runId);
      } catch (error) {
        console.error("[Sections] Immediate run failed", error);
      }
    });
    return NextResponse.json({ state }, { status: 202 });
  });
}
