import { surfaceErrorsPostSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import {
  appendSurfaceErrors,
  clearSurfaceErrors,
} from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const { errors, rev } = await readBody(request, surfaceErrorsPostSchema);
    return NextResponse.json({
      errors: await appendSurfaceErrors(id, errors, rev),
    });
  });
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    await clearSurfaceErrors(id);
    return NextResponse.json({ errors: [] });
  });
}
