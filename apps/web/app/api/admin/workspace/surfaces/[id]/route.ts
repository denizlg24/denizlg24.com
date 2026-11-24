import { surfacePatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import {
  deleteSurface,
  getSurface,
  updateSurface,
} from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () =>
    NextResponse.json({ surface: await getSurface(id) }),
  );
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (_service, caller) => {
    const patch = await readBody(request, surfacePatchSchema);
    return NextResponse.json({
      surface: await updateSurface(id, patch, caller),
    });
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    await deleteSurface(id);
    return NextResponse.json({ deleted: true });
  });
}
