import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";
import { surfaceHistory } from "@/lib/workspace/surfaces";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const limit = Number(request.nextUrl.searchParams.get("limit"));
  return withWorkspace(request, async () =>
    NextResponse.json({
      revisions: await surfaceHistory(
        id,
        Number.isFinite(limit) && limit > 0 ? limit : undefined,
      ),
    }),
  );
}
