import { type NextRequest, NextResponse } from "next/server";
import { deleteCard, getCardById, updateCard } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { cardId } = await params;
    const card = await getCardById(cardId);
    if (!card)
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    return NextResponse.json({ card }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch card" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { cardId } = await params;
    const body = await request.json();
    const card = await updateCard(cardId, body);
    if (!card)
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    return NextResponse.json({ card }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to update card" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { cardId } = await params;
    const deleted = await deleteCard(cardId);
    if (!deleted)
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to delete card" },
      { status: 500 },
    );
  }
}
