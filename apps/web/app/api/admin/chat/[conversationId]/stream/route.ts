import { type NextRequest, NextResponse } from "next/server";
import { getLiveTurn } from "@/lib/agent/live-turns";
import { followTurnEvents } from "@/lib/agent/turn-follow";
import {
  isTurnLive,
  readActiveTurn,
  reapStaleTurn,
} from "@/lib/agent/turn-store";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 300;

/**
 * Re-attaches to the conversation's running turn after a refresh, a
 * navigation or a dropped connection. 204 when nothing is running.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { conversationId } = await params;
  try {
    await reapStaleTurn(conversationId);
    const turn = await readActiveTurn(conversationId);
    if (!getLiveTurn(conversationId) && !isTurnLive(turn)) {
      return new NextResponse(null, { status: 204 });
    }
    return new Response(
      followTurnEvents({ conversationId, signal: request.signal }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      },
    );
  } catch (error) {
    console.error("Agent stream resume failed:", error);
    return NextResponse.json(
      { error: "Failed to resume the turn" },
      { status: 500 },
    );
  }
}
