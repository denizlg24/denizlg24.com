import { workspacePageMoveSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const move = await readBody(request, workspacePageMoveSchema);
    return NextResponse.json({
      page: await service.movePage(id, move, caller),
    });
  });
}
