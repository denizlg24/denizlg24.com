import { updateConversationInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  getConversation,
  IncognitoConversationConflictError,
  updateConversation,
} from "@/lib/conversations";
import { requireAdmin } from "@/lib/require-admin";

function serialize(
  conversation: NonNullable<Awaited<ReturnType<typeof getConversation>>>,
) {
  return {
    _id: conversation._id,
    title: conversation.title,
    llmModel: conversation.llmModel,
    memoryMode: conversation.memoryMode,
    messages: conversation.messages,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

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
    return NextResponse.json({ conversation: serialize(conversation) });
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
    const parsed = updateConversationInputSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A title or memoryMode is required" },
        { status: 400 },
      );
    }
    const conversation = await updateConversation(conversationId, parsed.data);
    if (!conversation)
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    return NextResponse.json({ conversation: serialize(conversation) });
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
    return NextResponse.json({ success: true });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to delete conversation" },
      { status: 500 },
    );
  }
}
