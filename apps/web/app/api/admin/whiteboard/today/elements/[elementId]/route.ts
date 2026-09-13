import { whiteboardElementPatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { patchBoardElement, todayBoardStore } from "@/lib/whiteboard-elements";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ elementId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = whiteboardElementPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid element patch", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { elementId } = await params;
  const store = todayBoardStore;
  const result = await patchBoardElement(store, elementId, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
