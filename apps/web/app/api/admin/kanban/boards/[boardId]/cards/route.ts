import { type NextRequest, NextResponse } from "next/server";
import { createCard, getBoardCards } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { boardId } = await params;
    const { searchParams } = new URL(request.url);
    const columnId = searchParams.get("columnId") ?? undefined;
    const cards = await getBoardCards(boardId, columnId);
    return NextResponse.json({ cards }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch cards" },
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
    const { columnId, title, description, labels, priority, dueDate } = body;

    if (!columnId) {
      return NextResponse.json(
        { error: "columnId is required" },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const card = await createCard(boardId, columnId, {
      title,
      description,
      labels,
      priority,
      dueDate,
    });
    return NextResponse.json({ card }, { status: 201 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to create card" },
      { status: 500 },
    );
  }
}
