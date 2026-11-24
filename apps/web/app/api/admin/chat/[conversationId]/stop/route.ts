import type { AgentStopResponse } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { stopConversationTurn } from "@/lib/agent/stop-turn";
import { setQueuePaused } from "@/lib/agent/turn-store";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { conversationId } = await params;
  try {
    // Before stopping: the waiting messages must not go out on the release.
    await setQueuePaused(conversationId, true);
    const result: AgentStopResponse =
      await stopConversationTurn(conversationId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Agent stop failed:", error);
    return NextResponse.json({ error: "Failed to stop" }, { status: 500 });
  }
}
