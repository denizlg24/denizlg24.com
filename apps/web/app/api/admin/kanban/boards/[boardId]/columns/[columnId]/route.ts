import { type NextRequest, NextResponse } from "next/server";
import { deleteColumn, updateColumn } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; columnId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { columnId } = await params;
    const body = await request.json();
    const column = await updateColumn(columnId, body);
    if (!column)
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    return NextResponse.json({ column }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to update column" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; columnId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { columnId } = await params;
    const deleted = await deleteColumn(columnId);
    if (!deleted)
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to delete column" },
      { status: 500 },
    );
  }
}
