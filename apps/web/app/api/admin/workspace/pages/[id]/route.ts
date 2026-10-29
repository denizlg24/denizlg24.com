import { pageMetaPatchSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service) =>
    NextResponse.json({ page: await service.getPage(id) }),
  );
}

/** Title, icon, full width, locked. */
export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) => {
    const set = await readBody(request, pageMetaPatchSchema);
    return NextResponse.json({
      page: await service.updateMeta(id, set, caller),
    });
  });
}

/** Deletes a trashed page and its subtree for good. */
export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return withWorkspace(request, async (service, caller) =>
    NextResponse.json({ purged: await service.purgePage(id, caller) }),
  );
}
