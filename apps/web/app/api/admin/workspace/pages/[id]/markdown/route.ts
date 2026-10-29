import { workspaceMarkdownPutSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service) =>
    NextResponse.json(await service.toMarkdown(id)),
  );
}

/** Replaces the blocks from markdown; `baseRev` must be the current rev. */
export async function PUT(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const { baseRev, markdown } = await readBody(
      request,
      workspaceMarkdownPutSchema,
    );
    return NextResponse.json({
      page: await service.fromMarkdown(id, baseRev, markdown, caller),
    });
  });
}
