import { surfaceSourceRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { surfaceSource } from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (_service, caller) => {
    const input = await readBody(request, surfaceSourceRequestSchema);
    return NextResponse.json(await surfaceSource(id, input, caller));
  });
}
