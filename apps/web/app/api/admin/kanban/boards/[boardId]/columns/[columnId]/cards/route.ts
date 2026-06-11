import { type NextRequest, NextResponse } from "next/server";
import { clearColumnCards } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; columnId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId, columnId } = await params;
    const result = await clearColumnCards(boardId, columnId);
    if (!result) {
      return NextResponse.json({ error: "Column not found" }, { status: 404 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to clear column cards" },
      { status: 500 },
    );
  }
}
