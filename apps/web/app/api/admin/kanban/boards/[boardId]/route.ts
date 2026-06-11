import { type NextRequest, NextResponse } from "next/server";
import { deleteBoard, getFullBoard, updateBoard } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId } = await params;
    const board = await getFullBoard(boardId);
    if (!board)
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    return NextResponse.json({ board }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch board" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId } = await params;
    const body = await request.json();
    const board = await updateBoard(boardId, body);
    if (!board)
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    return NextResponse.json({ board }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to update board" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId } = await params;
    const deleted = await deleteBoard(boardId);
    if (!deleted)
      return NextResponse.json({ error: "Board not found" }, { status: 404 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to delete board" },
      { status: 500 },
    );
  }
}
