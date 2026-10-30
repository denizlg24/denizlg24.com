import { triggerPatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { deleteTrigger, updateTrigger } from "@/lib/workflows/triggers";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const patch = await readBody(request, triggerPatchSchema);
    return NextResponse.json({ trigger: await updateTrigger(id, patch) });
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    await deleteTrigger(id);
    return NextResponse.json({ deleted: true });
  });
}
