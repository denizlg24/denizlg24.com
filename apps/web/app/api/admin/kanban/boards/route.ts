import { type NextRequest, NextResponse } from "next/server";
import { createBoard, getAllBoards } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const boards = await getAllBoards();
    return NextResponse.json({ boards }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch boards" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { title, description, color } = body;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const board = await createBoard({ title, description, color });
    return NextResponse.json({ board }, { status: 201 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to create board" },
      { status: 500 },
    );
  }
}
