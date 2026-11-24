import { surfaceStatePutSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { setSurfaceState } from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const { state } = await readBody(request, surfaceStatePutSchema);
    return NextResponse.json({ state: await setSurfaceState(id, state) });
  });
}
