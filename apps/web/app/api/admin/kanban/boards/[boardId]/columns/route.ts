import { type NextRequest, NextResponse } from "next/server";
import { createColumn, getBoardColumns } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId } = await params;
    const columns = await getBoardColumns(boardId);
    return NextResponse.json({ columns }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch columns" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId } = await params;
    const body = await request.json();
    const { title, color, wipLimit, icon } = body;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const column = await createColumn(boardId, {
      title,
      color,
      wipLimit,
      icon,
    });
    return NextResponse.json({ column }, { status: 201 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to create column" },
      { status: 500 },
    );
  }
}
