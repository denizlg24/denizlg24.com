import { updateSprintSlotSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withSprints } from "@/lib/sprints/http";
import { deleteSlot, updateSlot } from "@/lib/sprints/service";

type Context = { params: Promise<{ id: string; slotId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  return withSprints(request, async () => {
    const { id, slotId } = await params;
    const input = await readBody(request, updateSprintSlotSchema);
    return NextResponse.json({ slot: await updateSlot(id, slotId, input) });
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return withSprints(request, async () => {
    const { id, slotId } = await params;
    return NextResponse.json(await deleteSlot(id, slotId));
  });
}
