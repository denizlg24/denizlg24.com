import { type NextRequest, NextResponse } from "next/server";
import {
  deleteConversation,
  getConversation,
  updateConversationMessages,
} from "@/lib/conversations";
import { requireAdmin } from "@/lib/require-admin";

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
    const conversation = await updateConversationMessages(
      conversationId,
      body.messages,
    );
    if (!conversation)
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    return NextResponse.json({ conversation }, { status: 200 });
  } catch (_error) {
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
