import { type NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

/** Trashes the page and its subtree. */
export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) =>
    NextResponse.json({ pages: await service.archivePage(id, caller) }),
  );
}
