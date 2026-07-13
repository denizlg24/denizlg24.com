import { agentMemoryModeSchema, chatMessageSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  getConversation,
  IncognitoConversationConflictError,
  updateConversationMemoryMode,
  updateConversationMessages,
} from "@/lib/conversations";
import { requireAdmin } from "@/lib/require-admin";
import { toStoredMessage } from "./message-storage";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { conversationId } = await params;
    const conversation = await getConversation(conversationId);
    if (!conversation)
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    return NextResponse.json({ conversation }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch conversation" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { conversationId } = await params;
    const body = await request.json();
    const memoryModeResult = agentMemoryModeSchema.safeParse(body.memoryMode);
    const messagesResult = chatMessageSchema.array().safeParse(body.messages);
    if (body.memoryMode !== undefined && body.messages !== undefined) {
      return NextResponse.json(
        {
          error: "Update messages or memoryMode in a single request, not both",
        },
        { status: 400 },
      );
    }
    if (body.memoryMode !== undefined && !memoryModeResult.success) {
      return NextResponse.json(
        { error: "Invalid memoryMode" },
        { status: 400 },
      );
    }
    if (body.memoryMode === undefined && !messagesResult.success) {
      return NextResponse.json(
        { error: "A valid messages array or memoryMode is required" },
        { status: 400 },
      );
    }
    let conversation:
      | Awaited<ReturnType<typeof updateConversationMemoryMode>>
      | Awaited<ReturnType<typeof updateConversationMessages>>;
    if (memoryModeResult.success) {
      conversation = await updateConversationMemoryMode(
        conversationId,
        memoryModeResult.data,
      );
    } else if (messagesResult.success) {
      const parsedMessages = messagesResult.data.map(toStoredMessage);
      if (parsedMessages.some((message) => message === null)) {
        return NextResponse.json(
          { error: "Every message requires valid content and a timestamp" },
          { status: 400 },
        );
      }
      conversation = await updateConversationMessages(
        conversationId,
        parsedMessages.filter((message) => message !== null),
      );
    } else {
      return NextResponse.json(
        { error: "A valid messages array or memoryMode is required" },
        { status: 400 },
      );
    }
    if (!conversation)
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    return NextResponse.json({ conversation }, { status: 200 });
  } catch (error) {
    if (error instanceof IncognitoConversationConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Failed to update conversation" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { conversationId } = await params;
    const deleted = await deleteConversation(conversationId);
    if (!deleted)
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 },
    );
  }
}
