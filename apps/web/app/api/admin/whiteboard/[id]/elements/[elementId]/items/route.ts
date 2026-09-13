import { whiteboardComponentItemOpsSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { boardStore, editBoardComponentItems } from "@/lib/whiteboard-elements";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; elementId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = whiteboardComponentItemOpsSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid item operations", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { id, elementId } = await params;
  const store = boardStore(id);
  const result = await editBoardComponentItems(store, elementId, parsed.data);
  return NextResponse.json(result.body, { status: result.status });
}
