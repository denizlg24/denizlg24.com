import { surfaceRevertSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { revertSurface } from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (_service, caller) => {
    const { rev } = await readBody(request, surfaceRevertSchema);
    return NextResponse.json({ surface: await revertSurface(id, rev, caller) });
  });
}
