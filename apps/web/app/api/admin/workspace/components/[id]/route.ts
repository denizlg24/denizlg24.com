import { componentPatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  deleteComponent,
  getComponent,
  updateComponent,
} from "@/lib/workspace/components";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () =>
    NextResponse.json({ component: await getComponent(id) }),
  );
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const patch = await readBody(request, componentPatchSchema);
    return NextResponse.json({ component: await updateComponent(id, patch) });
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    await deleteComponent(id);
    return NextResponse.json({ deleted: true });
  });
}
