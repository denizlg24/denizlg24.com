import { templateFromBlocksSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

export async function GET(request: NextRequest) {
  return withWorkspace(request, async (service) =>
    NextResponse.json({ templates: await service.listTemplates() }),
  );
}

/** Blocks of a page copied into a new template. */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async (service, caller) => {
    const input = await readBody(request, templateFromBlocksSchema);
    return NextResponse.json(
      { page: await service.templateFromBlocks(input, caller) },
      { status: 201 },
    );
  });
}
