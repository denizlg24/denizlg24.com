import { agentQueueInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AgentMergeError, sanitizeUserMessage } from "@/lib/agent/merge";
import {
  dequeueMessage,
  enqueueMessage,
  QueueFullError,
} from "@/lib/agent/turn-store";
import { requireAdmin } from "@/lib/require-admin";

type Params = { params: Promise<{ conversationId: string }> };

/** Adds a message to wait behind the running turn; re-sending its id is a no-op. */
export async function POST(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { conversationId } = await params;
  const parsed = agentQueueInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success || parsed.data.message.role !== "user") {
    return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  }
  try {
    const message = sanitizeUserMessage(parsed.data.message);
    const queue = await enqueueMessage(conversationId, message);
    if (!queue) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ queue });
  } catch (error) {
    if (error instanceof AgentMergeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof QueueFullError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Queueing a message failed:", error);
    return NextResponse.json({ error: "Failed to queue" }, { status: 500 });
  }
}

/** `?messageId=` leaves the queue. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { conversationId } = await params;
  const messageId = request.nextUrl.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json(
      { error: "messageId is required" },
      { status: 400 },
    );
  }
  try {
    const queue = await dequeueMessage(conversationId, messageId);
    if (!queue) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ queue });
  } catch (error) {
    console.error("Unqueueing a message failed:", error);
    return NextResponse.json({ error: "Failed to unqueue" }, { status: 500 });
  }
}
