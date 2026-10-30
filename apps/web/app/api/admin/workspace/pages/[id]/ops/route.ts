import { workspaceOpsRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

/** A batch of block ops against `baseRev`; 409 with the current page when it cannot rebase. */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const body = await readBody(request, workspaceOpsRequestSchema);
    return NextResponse.json({
      page: await service.applyOps(id, body, caller),
    });
  });
}
