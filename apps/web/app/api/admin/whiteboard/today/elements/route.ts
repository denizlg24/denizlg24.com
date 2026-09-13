import {
  whiteboardAddElementsSchema,
  whiteboardDeleteElementsSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import {
  addBoardElements,
  removeBoardElements,
  todayBoardStore,
} from "@/lib/whiteboard-elements";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = whiteboardAddElementsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid elements", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const store = todayBoardStore;
  const result = await addBoardElements(store, parsed.data.elements);
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = whiteboardDeleteElementsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid elementIds", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const store = todayBoardStore;
  const result = await removeBoardElements(store, parsed.data.elementIds);
  return NextResponse.json(result.body, { status: result.status });
}
