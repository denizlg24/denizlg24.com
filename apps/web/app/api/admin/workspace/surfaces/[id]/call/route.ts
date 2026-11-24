import { surfaceCallSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { callSurfaceTool } from "@/lib/workspace/surfaces";

export const maxDuration = 120;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async () => {
    const call = await readBody(request, surfaceCallSchema);
    return NextResponse.json(await callSurfaceTool(id, call));
  });
}
