import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspace } from "@/lib/workspace/http";
import { WorkspaceError } from "@/lib/workspace/service";

type Context = { params: Promise<{ id: string }> };

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().min(1).optional(),
});

/** Revisions, newest first; `before` pages back. */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service) => {
    const params = request.nextUrl.searchParams;
    const query = querySchema.safeParse({
      limit: params.get("limit") ?? undefined,
      before: params.get("before") ?? undefined,
    });
    if (!query.success) {
      throw new WorkspaceError(400, "INVALID_INPUT", "Invalid history query");
    }
    return NextResponse.json({
      revisions: await service.history(id, query.data),
    });
  });
}
