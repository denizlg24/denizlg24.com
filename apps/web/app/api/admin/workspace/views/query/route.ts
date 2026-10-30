import {
  VIEW_SOURCES,
  type ViewConfig,
  viewConfigSchema,
  viewQueryRequestSchema,
} from "@repo/schemas";
import { findBlock } from "@repo/utils/workspace-tree";
import { utcToday, viewConfigProblems } from "@repo/utils/workspace-views";
import { type NextRequest, NextResponse } from "next/server";
import { readBody, withWorkspace } from "@/lib/workspace/http";
import { WorkspaceError } from "@/lib/workspace/service";
import { queryView } from "@/lib/workspace/views";

export const runtime = "nodejs";

/**
 * `{ view }` or `{ pageId, blockId }` (a stored view block), plus `cursor`,
 * `limit` and the caller's `today` → one page of the view's rows with its
 * groups, per-currency totals and select options. See `lib/workspace/views.ts`.
 */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async (service) => {
    const body = await readBody(request, viewQueryRequestSchema);
    let view: ViewConfig;
    if (body.view) {
      view = body.view;
    } else {
      const page = await service.getPage(body.pageId ?? "");
      const block = findBlock(page.blocks, body.blockId ?? "")?.block;
      if (block?.type !== "view") {
        throw new WorkspaceError(
          404,
          "NOT_FOUND",
          "No view block with that id",
        );
      }
      view = viewConfigSchema.parse(block);
    }
    const problems = viewConfigProblems(VIEW_SOURCES[view.source], view);
    if (problems.length > 0) {
      throw new WorkspaceError(400, "INVALID_VIEW", problems.join("; "), {
        problems,
      });
    }
    return NextResponse.json(
      await queryView(view, {
        today: body.today ?? utcToday(),
        cursor: body.cursor ? Number(body.cursor) : undefined,
        limit: body.limit,
      }),
    );
  });
}
