import { workspaceSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";

/*
 * The v1 whole-document API, kept for desktop 3.0.0 on top of per-page
 * storage. Nothing newer calls it.
 *
 * GET assembles the document from pages and prefs, records it as the base
 * 3.0.0 now holds, and stamps `savedAt` with the server's now so 3.0.0 adopts
 * it instead of pushing its own copy.
 *
 * PUT merges each page three ways — that base, the stored page, the incoming
 * page — and writes only 3.0.0's own edits since the base, block by block and
 * page field by page field, skipping any block or field someone else changed
 * meanwhile. The incoming page then becomes the new base. A stale PUT
 * therefore never undoes an agent's or the web's edit; on a collision the
 * stored copy wins and 3.0.0's edit to that block is dropped. A page missing
 * from the PUT is purged only when it is trashed and unchanged since 3.0.0
 * last held it. Unknown keys, such as the web port's `baseSavedAt`, are
 * stripped.
 */

export async function GET(request: NextRequest) {
  return withWorkspace(request, async (service) =>
    NextResponse.json({ workspace: await service.compatGet() }),
  );
}

export async function PUT(request: NextRequest) {
  return withWorkspace(request, async (service) => {
    const workspace = await readBody(request, workspaceSchema);
    await service.compatPut(workspace);
    return NextResponse.json({
      savedAt: workspace.savedAt ?? new Date().toISOString(),
    });
  });
}
