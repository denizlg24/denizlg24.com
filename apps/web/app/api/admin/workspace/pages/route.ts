import { workspacePageCreateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readBody, withWorkspace } from "@/lib/workspace/http";

const createBodySchema = workspacePageCreateSchema.extend({
  /** Builds the blocks from markdown instead of `blocks`. */
  markdown: z.string().max(400_000).optional(),
});

export async function GET(request: NextRequest) {
  return withWorkspace(request, async (service) =>
    NextResponse.json({ pages: await service.listPages() }),
  );
}

export async function POST(request: NextRequest) {
  return withWorkspace(request, async (service, caller) => {
    const input = await readBody(request, createBodySchema);
    return NextResponse.json(
      { page: await service.createPage(input, caller) },
      { status: 201 },
    );
  });
}
